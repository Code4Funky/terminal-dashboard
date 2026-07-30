import { useState, useEffect, useRef } from "react";
import { useTheme } from "../ThemeContext";
import { RADIUS, RADIUS_SM, TRANSITION, drawerHeader, drawerTitle } from "../chrome";
import { MONO_FONT } from "../theme";
import type { GhPRNode } from "../hooks/useTerminal";
import type { RepoEntry } from "../hooks/usePRInbox";
import {
  PR_CATEGORIES, UPDATED_WINDOWS, bucketPRs, withinUpdatedWindow,
  type PRCategory, type UpdatedWindow,
} from "../prs";

type PR = GhPRNode;

// GitHub's five Pull-requests views. "inbox" is served entirely from the local repo fan-out; the other
// four go through `gh search prs` for identity, then hydrate, so they also see repos with no local clone.
type PRView = "inbox" | "authored" | "assigned" | "involves" | "reviewRequested";

const PR_VIEWS: { key: PRView; label: string }[] = [
  { key: "inbox",           label: "Inbox" },
  { key: "authored",        label: "Authored by me" },
  { key: "assigned",        label: "Assigned to me" },
  { key: "involves",        label: "Involves me" },
  { key: "reviewRequested", label: "Review requests" },
];

export interface SelectedPR {
  prNumber: number;
  repoName: string;
  prTitle: string;
  branch: string;
  prUrl: string;
}

interface Props {
  onClose: () => void;
  onOpenTerminal: (repoName: string, branchName: string) => void;
  onOpenRepo: (repoName: string, branchName: string) => void;
  onRunClaudeAction: (repoName: string, branchName: string, cmd: string) => void;
  onSelectPR?: (sel: SelectedPR) => void;
  width?: number;
  onWidthChange?: (w: number) => void;
  // Inbox data is owned by Dashboard (`usePRInbox`) so the Sessions panel counts the same PRs.
  prs: PR[];
  repos: RepoEntry[];
  loading: boolean;
  error: string | null;
  lastRefreshed: Date;
  ghLogin: string | null;
  myTeams: Set<string>;
  updatedWithin: UpdatedWindow;
  onUpdatedWithinChange: (w: UpdatedWindow) => void;
  onRefresh: () => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) {
    const hours = Math.floor(diff / 3600000);
    if (hours === 0) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function ReviewPill({ decision }: { decision: string | null }) {
  const { theme: t } = useTheme();
  type Cfg = { label: string; color: string; bg: string };
  const configs: Record<string, Cfg> = {
    APPROVED:          { label: "Approved",          color: t.green,  bg: `${t.green}18` },
    CHANGES_REQUESTED: { label: "Changes requested", color: t.red,    bg: `${t.red}15` },
    REVIEW_REQUIRED:   { label: "Review pending",    color: t.orange, bg: `${t.orange}15` },
  };
  const cfg = configs[decision ?? "REVIEW_REQUIRED"] ?? configs.REVIEW_REQUIRED;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, fontWeight: 600,
      color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.color}30`,
      borderRadius: RADIUS, padding: "2px 8px",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.color, flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { theme: t } = useTheme();
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={copy} title={`Copy ${label}`} style={{
      background: "none", border: "none", cursor: "pointer",
      color: copied ? t.teal : t.label4,
      fontSize: 13, padding: "1px 3px", borderRadius: 3,
      lineHeight: 1, transition: "color 0.15s", flexShrink: 0,
    }}
      onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = t.label2; }}
      onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = t.label4; }}
    >
      {copied ? "✓" : "⎘"}
    </button>
  );
}

function PRSectionHeader({ label, count, open, color, onToggle }: {
  label: string; count: number; open: boolean; color: string; onToggle: () => void;
}) {
  const { theme: t } = useTheme();
  return (
    <button
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", gap: 7, width: "100%",
        background: "none", border: "none", cursor: "pointer", padding: "7px 16px",
        textAlign: "left",
      }}
    >
      <span style={{ fontSize: 9, color: t.label4, width: 8, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
      <span style={{ flex: 1, color: t.label1, fontSize: 12, fontWeight: 600 }}>{label}</span>
      <span style={{
        color, fontSize: 10,
        background: `${color}15`, border: `1px solid ${color}28`,
        borderRadius: RADIUS, padding: "1px 6px", ...MONO_FONT,
      }}>{count}</span>
    </button>
  );
}

function PRCard({ pr, onOpenTerminal, onRunClaudeAction, onSelectPR }: {
  pr: PR;
  onOpenTerminal: (repo: string, branch: string) => void;
  onRunClaudeAction: (repo: string, branch: string, cmd: string) => void;
  onSelectPR?: (sel: SelectedPR) => void;
}) {
  const { theme: t } = useTheme();
  const [hovered, setHovered] = useState(false);
  const [cooldown, setCooldown] = useState<Set<string>>(new Set());
  const [showActions, setShowActions] = useState(false);
  const shortSha = pr.headRefOid.slice(0, 7);

  const handleClaudeAction = (label: string, repo: string, branch: string, cmd: string) => {
    if (cooldown.has(label)) return;
    setCooldown((prev) => new Set(prev).add(label));
    onRunClaudeAction(repo, branch, cmd);
    setTimeout(() => setCooldown((prev) => { const n = new Set(prev); n.delete(label); return n; }), 2000);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        margin: "0 12px 8px", padding: "13px 14px",
        background: hovered ? t.surface3 : t.surface2,
        border: `1px solid ${hovered ? t.borderMid : t.borderSubtle}`,
        borderRadius: RADIUS,
        transition: TRANSITION,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: pr.isDraft ? t.label4 : t.green, flexShrink: 0, marginTop: 2 }}>
          {pr.isDraft ? "⎓" : "⎇"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: t.label1, fontSize: 12, fontWeight: 600, lineHeight: 1.5 }}>{pr.title}</div>
          <div style={{ color: t.label4, fontSize: 10, ...MONO_FONT, marginTop: 2 }}>
            {pr.repository.nameWithOwner}#{pr.number} · {pr.author.login} · Updated {timeAgo(pr.updatedAt)}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <ReviewPill decision={pr.reviewDecision} />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          background: `${t.blue}10`, border: `1px solid ${t.blue}28`,
          borderRadius: RADIUS, padding: "4px 8px", flex: 1, minWidth: 0,
        }}>
          <span style={{ color: t.blue, fontSize: 12, flexShrink: 0 }}>⎇</span>
          <span style={{ fontSize: 12, color: t.blue, ...MONO_FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pr.headRefName}
          </span>
          <CopyButton text={pr.headRefName} label="branch" />
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          background: `${t.orange}10`, border: `1px solid ${t.orange}28`,
          borderRadius: RADIUS, padding: "4px 8px", flexShrink: 0,
        }}>
          <span style={{ color: t.orange, fontSize: 12 }}>◉</span>
          <span style={{ fontSize: 12, color: t.orange, ...MONO_FONT }}>{shortSha}</span>
          <CopyButton text={pr.headRefOid} label="commit SHA" />
        </div>
      </div>

      {/* Primary actions */}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => window.terminal.openExternal(pr.url)}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            background: `${t.blue}12`, border: `1px solid ${t.blue}30`,
            borderRadius: RADIUS, color: t.blue,
            cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "6px 10px",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = `${t.blue}25`; b.style.borderColor = `${t.blue}55`; }}
          onMouseLeave={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = `${t.blue}12`; b.style.borderColor = `${t.blue}30`; }}
        >
          <span style={{ fontSize: 11 }}>↗</span> Open PR
        </button>
        <button
          onClick={() => onOpenTerminal(pr.repository.name, pr.headRefName)}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            background: `${t.teal}10`, border: `1px solid ${t.teal}28`,
            borderRadius: RADIUS, color: t.teal,
            cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "6px 10px",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = `${t.teal}22`; b.style.borderColor = `${t.teal}50`; }}
          onMouseLeave={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = `${t.teal}10`; b.style.borderColor = `${t.teal}28`; }}
        >
          <span style={{ fontSize: 11 }}>⌨</span> Terminal
        </button>
        <button
          onClick={() => onSelectPR?.({
            prNumber: pr.number, repoName: pr.repository.name,
            prTitle: pr.title, branch: pr.headRefName, prUrl: pr.url,
          })}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            background: `${t.purple}10`, border: `1px solid ${t.purple}28`,
            borderRadius: RADIUS, color: t.purple,
            cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "6px 10px",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = `${t.purple}22`; b.style.borderColor = `${t.purple}50`; }}
          onMouseLeave={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = `${t.purple}10`; b.style.borderColor = `${t.purple}28`; }}
        >
          <span style={{ fontSize: 11 }}>±</span> Diff
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setShowActions((v) => !v); }}
          title="Claude actions"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            background: showActions ? `${t.green}15` : "transparent",
            border: `1px solid ${showActions ? `${t.green}40` : t.borderSubtle}`,
            borderRadius: RADIUS, color: showActions ? t.green : t.label4,
            cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "6px 10px",
            transition: "all 0.15s", flexShrink: 0,
          }}
          onMouseEnter={(e) => { const b = e.currentTarget; if (!showActions) { b.style.background = t.surface3; b.style.color = t.label2; } }}
          onMouseLeave={(e) => { const b = e.currentTarget; if (!showActions) { b.style.background = "transparent"; b.style.color = t.label4; } }}
        >…</button>
      </div>

      {/* Claude Actions — overflow panel */}
      {showActions && (
        <div style={{ marginTop: 7 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
            {([
              { label: "PR Comments", icon: "✏", cmd: `claude "/pr-comments"`,                    color: t.orange },
              { label: "CodeRabbit",  icon: "◈", cmd: `claude "/action-coderabbit ${pr.number}"`, color: t.purple },
              { label: "Review",      icon: "◎", cmd: `claude "/review"`,                         color: t.blue   },
              { label: "PR Fixer",    icon: "⚙", cmd: `claude "/pr-fixer"`,                       color: t.green  },
            ] as const).map(({ label, icon, cmd, color }) => {
              const busy = cooldown.has(label);
              return (
                <button
                  key={label}
                  onClick={() => handleClaudeAction(label, pr.repository.name, pr.headRefName, cmd)}
                  disabled={busy}
                  title={busy ? "Opening terminal…" : `Open terminal and run: ${cmd}`}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    background: busy ? `${color}18` : `${color}10`,
                    border: `1px solid ${busy ? `${color}50` : `${color}28`}`,
                    borderRadius: RADIUS, color,
                    cursor: busy ? "not-allowed" : "pointer",
                    fontSize: 10, fontWeight: 600, padding: "6px 8px",
                    opacity: busy ? 0.55 : 1,
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { if (!busy) { const b = e.currentTarget; b.style.background = `${color}20`; b.style.borderColor = `${color}50`; } }}
                  onMouseLeave={(e) => { if (!busy) { const b = e.currentTarget; b.style.background = `${color}10`; b.style.borderColor = `${color}28`; } }}
                >
                  <span style={{ fontSize: 11 }}>{busy ? "⟳" : icon}</span> {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function PRsDrawer({
  onClose, onOpenTerminal, onOpenRepo, onRunClaudeAction, onSelectPR,
  width: controlledWidth, onWidthChange,
  prs, repos, loading, error, lastRefreshed, ghLogin, myTeams, updatedWithin, onUpdatedWithinChange, onRefresh,
}: Props) {
  const { theme: t } = useTheme();

  // ── Drawer resize ────────────────────────────────────────────────────────────
  const [internalWidth, setInternalWidth] = useState(controlledWidth ?? 480);
  const drawerWidth = controlledWidth ?? internalWidth;
  const drawerDragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const onDrawerResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drawerDragState.current = { startX: e.clientX, startWidth: drawerWidth };
    const onMove = (ev: MouseEvent) => {
      if (!drawerDragState.current) return;
      // Docked left of centre, so the handle is on the trailing edge — drag right widens
      const delta = ev.clientX - drawerDragState.current.startX;
      const max = Math.max(520, window.innerWidth - 640);
      const w = Math.max(320, Math.min(max, drawerDragState.current.startWidth + delta));
      if (controlledWidth !== undefined) { onWidthChange?.(w); } else { setInternalWidth(w); }
    };
    const onUp = () => { drawerDragState.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const [claudeWorktrees, setClaudeWorktrees] = useState<{ repo: string; branch: string; path: string; merged: boolean }[]>([]);
  const [showWorktrees, setShowWorktrees] = useState(true);
  const [wtMsg, setWtMsg] = useState<string | null>(null);
  const [showWindowMenu, setShowWindowMenu] = useState(false);
  // Not persisted on purpose: opening straight onto a search-backed view would fire a search on mount.
  const [view, setView] = useState<PRView>("inbox");
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [viewCache, setViewCache] = useState<Partial<Record<PRView, PR[]>>>({});
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [sectionOverride, setSectionOverride] = useState<Partial<Record<PRCategory, boolean>>>({});
  const isSectionOpen = (key: PRCategory, count: number) => sectionOverride[key] ?? count > 0;
  const toggleSection = (key: PRCategory, count: number) =>
    setSectionOverride((prev) => ({ ...prev, [key]: !isSectionOpen(key, count) }));

  const CATEGORY_COLOR: Record<PRCategory, string> = {
    needsYourReview: t.blue,
    needsTeamReview: t.teal,
    yourDrafts: t.label3,
    waiting: t.orange,
    needsAction: t.red,
    readyToMerge: t.green,
  };

  const loadWorktrees = async () => {
    const wts = await window.terminal.listClaudeWorktrees().catch(() => []);
    const merged = wts.filter((w) => w.merged);
    const active = wts.filter((w) => !w.merged);
    if (merged.length > 0) {
      await Promise.all(merged.map((w) => window.terminal.removeClaudeWorktree(w.repo, w.path).catch(() => {})));
      setWtMsg(`Auto-removed ${merged.length} merged worktree${merged.length !== 1 ? "s" : ""}`);
      setTimeout(() => setWtMsg(null), 5000);
    }
    setClaudeWorktrees(active);
  };

  const handleRemoveWorktree = async (repo: string, path: string) => {
    await window.terminal.removeClaudeWorktree(repo, path).catch(() => {});
    setClaudeWorktrees((prev) => prev.filter((w) => w.path !== path));
  };

  // The fan-out itself lives in Dashboard; ↺ still drops the search caches, which don't.
  const load = () => {
    setViewCache({});
    onRefresh();
    loadWorktrees();
  };

  // Search returns identity only; anything the fan-out already fetched is reused, so only PRs in repos
  // you haven't cloned cost a `gh pr view`. Search order (updated-desc) is preserved.
  const loadView = async (v: PRView) => {
    if (v === "inbox") return;
    setViewLoading(true); setViewError(null);
    const keyOf = (repo: string, n: number) => `${repo}#${n}`;
    try {
      const refs = await window.terminal.searchPRRefs(v);
      const byKey = new Map(prs.map((p) => [keyOf(p.repository.nameWithOwner, p.number), p as PR]));
      const missing = refs.filter((r) => !byKey.has(keyOf(r.nameWithOwner, r.number)));
      for (const p of missing.length ? await window.terminal.hydratePRs(missing) : []) {
        byKey.set(keyOf(p.repository.nameWithOwner, p.number), p);
      }
      const ordered = refs
        .map((r) => byKey.get(keyOf(r.nameWithOwner, r.number)))
        .filter((p): p is PR => !!p);
      setViewCache((prev) => ({ ...prev, [v]: ordered }));
    } catch (err) {
      // Electron wraps handler errors — keep just the gh message (a 403 rate limit must stay visible).
      const raw = (err as Error).message ?? "";
      setViewError(raw.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, "") || "GitHub search failed");
    } finally {
      setViewLoading(false);
    }
  };

  const selectView = (v: PRView) => {
    setView(v);
    setShowViewMenu(false);
    setViewError(null);
    if (v !== "inbox" && !viewCache[v]) loadView(v);
  };

  useEffect(() => { loadWorktrees(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showWindowMenu) { setShowWindowMenu(false); return; }
      if (showViewMenu) { setShowViewMenu(false); return; }
      onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, showWindowMenu, showViewMenu]);

  const buckets = bucketPRs(prs, ghLogin, myTeams, updatedWithin);
  const inboxCount = Object.values(buckets).reduce((n, b) => n + (b?.length ?? 0), 0);

  // The Updated window applies to every view, so it stays instant — search is never re-issued for it.
  const viewPRs = (v: PRView): PR[] | undefined =>
    viewCache[v]?.filter((pr) => withinUpdatedWindow(pr, updatedWithin));
  const flatPRs = view === "inbox" ? [] : viewPRs(view) ?? [];
  const viewCount = (v: PRView) => (v === "inbox" ? inboxCount : viewPRs(v)?.length);
  const headerCount = view === "inbox" ? inboxCount : flatPRs.length;
  const busy = loading || viewLoading;

  return (
    <div style={{
      width: drawerWidth, minWidth: 320, flexShrink: 0,
      background: t.surface1,
      backdropFilter: t.backdropFilter,
      WebkitBackdropFilter: t.backdropFilter,
      borderLeft: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column",
      boxShadow: t.isDark ? "-4px 0 36px rgba(0,0,0,0.6)" : "-4px 0 20px rgba(0,0,0,0.08)",
      overflowY: "hidden",
      position: "relative",
    }}>
      {/* Right resize handle */}
      <div
        onMouseDown={onDrawerResizeDown}
        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 10 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = `${t.blue}40`; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      />
      <div style={{ ...drawerHeader(t), padding: "6px 10px 6px 14px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={drawerTitle(t)}>Pull requests</div>
          {!busy && (
            <div style={{ color: t.green, fontSize: 11, marginTop: 3, ...MONO_FONT }}>
              {headerCount} PRs
              {/* Only the inbox is bounded by what's cloned; search-backed views span every repo. */}
              {view === "inbox" && ` · ${repos.length} local repos`}
              <span style={{ color: t.label4 }}> · {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          )}
        </div>
        <button onClick={load} title="Refresh"
          style={{ background: "none", border: `1px solid ${t.borderMid}`, color: t.label3, cursor: "pointer", fontSize: 12, padding: "2px 8px", borderRadius: RADIUS, lineHeight: 1, transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
        >↺</button>
        <button onClick={onClose} title="Close"
          style={{ background: "none", border: `1px solid ${t.borderMid}`, color: t.label3, cursor: "pointer", fontSize: 12, padding: "2px 8px", borderRadius: RADIUS, lineHeight: 1, transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
        >✕</button>
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
        padding: "6px 14px", borderBottom: `1px solid ${t.border}`,
        position: "relative", flexShrink: 0,
      }}>
        {/* Each chip owns its own positioning context so its menu anchors under it, not the row. */}
        <div style={{ position: "relative" }}>
        <button
          onClick={() => { setShowViewMenu((v) => !v); setShowWindowMenu(false); }}
          title="Switch view"
          style={{
            display: "flex", alignItems: "center", gap: 5,
            background: showViewMenu ? t.surface3 : "transparent",
            border: `1px solid ${showViewMenu ? t.borderMid : t.borderSubtle}`,
            borderRadius: RADIUS, color: t.label2,
            cursor: "pointer", fontSize: 11, padding: "3px 8px",
            transition: TRANSITION,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = t.surface3; }}
          onMouseLeave={(e) => { if (!showViewMenu) e.currentTarget.style.background = "transparent"; }}
        >
          <span style={{ color: t.label4, fontSize: 11 }}>⊞</span>
          <span style={{ color: t.label1, fontWeight: 600 }}>
            {PR_VIEWS.find((v) => v.key === view)?.label}
          </span>
          <span style={{ fontSize: 9, color: t.label4 }}>▾</span>
        </button>

        {showViewMenu && (
          <>
            <div
              onClick={() => setShowViewMenu(false)}
              style={{ position: "fixed", inset: 0, zIndex: 20 }}
            />
            <div style={{
              position: "absolute", top: "calc(100% + 5px)", left: 0, zIndex: 21,
              minWidth: 196, padding: 3,
              background: t.surface2, border: `1px solid ${t.borderMid}`,
              borderRadius: RADIUS,
            }}>
              {PR_VIEWS.map(({ key, label }) => {
                const active = key === view;
                const n = viewCount(key);
                return (
                  <button
                    key={key}
                    onClick={() => selectView(key)}
                    style={{
                      display: "flex", alignItems: "center", gap: 7, width: "100%",
                      background: active ? t.surface3 : "transparent",
                      border: "none", borderRadius: RADIUS_SM,
                      color: active ? t.label1 : t.label2,
                      cursor: "pointer", fontSize: 11, fontWeight: active ? 600 : 400,
                      padding: "5px 8px", textAlign: "left",
                      transition: TRANSITION,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = t.surface3; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ width: 9, color: t.teal, fontSize: 10, flexShrink: 0 }}>{active ? "✓" : ""}</span>
                    <span style={{ flex: 1 }}>{label}</span>
                    {/* En dash until the view's first search resolves — 0 would read as "nothing here". */}
                    <span style={{ color: t.label4, fontSize: 10, ...MONO_FONT }}>{n ?? "–"}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        </div>

        <div style={{ position: "relative" }}>
        <button
          onClick={() => { setShowWindowMenu((v) => !v); setShowViewMenu(false); }}
          title="Filter by when the PR was last updated"
          style={{
            display: "flex", alignItems: "center", gap: 5,
            background: showWindowMenu ? t.surface3 : "transparent",
            border: `1px solid ${showWindowMenu ? t.borderMid : t.borderSubtle}`,
            borderRadius: RADIUS, color: t.label2,
            cursor: "pointer", fontSize: 11, padding: "3px 8px",
            transition: TRANSITION,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = t.surface3; }}
          onMouseLeave={(e) => { if (!showWindowMenu) e.currentTarget.style.background = "transparent"; }}
        >
          <span style={{ color: t.label4, fontSize: 11 }}>◷</span>
          Updated: <span style={{ color: t.label1, fontWeight: 600 }}>
            {UPDATED_WINDOWS.find((w) => w.key === updatedWithin)?.label}
          </span>
          <span style={{ fontSize: 9, color: t.label4 }}>▾</span>
        </button>

        {showWindowMenu && (
          <>
            <div
              onClick={() => setShowWindowMenu(false)}
              style={{ position: "fixed", inset: 0, zIndex: 20 }}
            />
            <div style={{
              position: "absolute", top: "calc(100% + 5px)", left: 0, zIndex: 21,
              minWidth: 168, padding: 3,
              background: t.surface2, border: `1px solid ${t.borderMid}`,
              borderRadius: RADIUS,
            }}>
              {UPDATED_WINDOWS.map(({ key, label }) => {
                const active = key === updatedWithin;
                return (
                  <button
                    key={key}
                    onClick={() => { onUpdatedWithinChange(key); setShowWindowMenu(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 7, width: "100%",
                      background: active ? t.surface3 : "transparent",
                      border: "none", borderRadius: RADIUS_SM,
                      color: active ? t.label1 : t.label2,
                      cursor: "pointer", fontSize: 11, fontWeight: active ? 600 : 400,
                      padding: "5px 8px", textAlign: "left",
                      transition: TRANSITION,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = t.surface3; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ width: 9, color: t.teal, fontSize: 10, flexShrink: 0 }}>{active ? "✓" : ""}</span>
                    {label}
                  </button>
                );
              })}
            </div>
          </>
        )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 0 20px" }}>
        {busy && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 10 }}>
            <div style={{ color: t.blue, fontSize: 22 }}>⟳</div>
            <div style={{ color: t.label3, fontSize: 12, ...MONO_FONT }}>
              {view === "inbox" ? "Fetching pull requests…" : "Searching GitHub…"}
            </div>
          </div>
        )}

        {error && (
          <div style={{ margin: 12, padding: "12px 14px", background: `${t.red}10`, border: `1px solid ${t.red}28`, borderRadius: RADIUS }}>
            <div style={{ color: t.red, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Failed to load PRs</div>
            <div style={{ color: t.label2, fontSize: 11, ...MONO_FONT }}>Make sure <code style={{ color: t.teal }}>gh</code> is installed and authenticated.</div>
          </div>
        )}

        {/* Surfaced, never swallowed: a search secondary-rate-limit 403 must not read as an empty view. */}
        {!busy && viewError && (
          <div style={{ margin: 12, padding: "12px 14px", background: `${t.red}10`, border: `1px solid ${t.red}28`, borderRadius: RADIUS }}>
            <div style={{ color: t.red, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>GitHub search failed</div>
            <div style={{ color: t.label2, fontSize: 11, marginBottom: 8, ...MONO_FONT, whiteSpace: "pre-wrap" }}>{viewError}</div>
            <button
              onClick={() => loadView(view)}
              style={{
                background: "none", border: `1px solid ${t.borderMid}`, borderRadius: RADIUS,
                color: t.label2, cursor: "pointer", fontSize: 11, padding: "3px 9px",
              }}
            >Retry</button>
          </div>
        )}

        {!busy && !error && !viewError && headerCount === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <div style={{ color: t.label1, fontSize: 13, fontWeight: 600 }}>No open PRs</div>
            <div style={{ color: t.label3, fontSize: 11, ...MONO_FONT }}>
              All caught up!
            </div>
          </div>
        )}

        {!busy && !error && view !== "inbox" && flatPRs.map((pr) => (
          <PRCard
            key={`${pr.repository.nameWithOwner}-${pr.number}`}
            pr={pr}
            onOpenTerminal={onOpenTerminal}
            onRunClaudeAction={(repo, branch, cmd) => {
              onRunClaudeAction(repo, branch, cmd);
              setTimeout(() => loadWorktrees(), 2500);
            }}
            onSelectPR={onSelectPR}
          />
        ))}

        {!busy && !error && view === "inbox" && ghLogin === null && (
          <div style={{
            margin: "0 12px 10px", padding: "10px 14px",
            background: `${t.orange}10`, border: `1px solid ${t.orange}28`, borderRadius: RADIUS,
          }}>
            <div style={{ color: t.orange, fontSize: 11, ...MONO_FONT }}>
              Could not detect your GitHub login — sections based on PR authorship won't populate.
              Check <code style={{ color: t.teal }}>gh auth status</code>.
            </div>
          </div>
        )}

        {!busy && !error && view === "inbox" && PR_CATEGORIES.map(({ key, label }) => {
          const bucket = buckets[key] ?? [];
          const color = CATEGORY_COLOR[key];
          const open = isSectionOpen(key, bucket.length);
          return (
            <div key={key} style={{ marginBottom: 2 }}>
              <PRSectionHeader
                label={label} count={bucket.length} open={open} color={color}
                onToggle={() => toggleSection(key, bucket.length)}
              />
              {open && bucket.map((pr) => (
                <PRCard
                  key={`${pr.repository.nameWithOwner}-${pr.number}`}
                  pr={pr}
                  onOpenTerminal={onOpenTerminal}
                  onRunClaudeAction={(repo, branch, cmd) => {
                    onRunClaudeAction(repo, branch, cmd);
                    setTimeout(() => loadWorktrees(), 2500);
                  }}
                  onSelectPR={onSelectPR}
                />
              ))}
            </div>
          );
        })}

        {(claudeWorktrees.length > 0 || wtMsg) && (
          <div style={{ marginTop: 8 }}>
            <div style={{ height: 1, background: t.borderMid, margin: "4px 16px 10px" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px 6px" }}>
              <button
                onClick={() => setShowWorktrees((v) => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, flex: 1,
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                  color: t.purple, fontSize: 13, fontWeight: 600, letterSpacing: 0.3,
                  textAlign: "left",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.purple, flexShrink: 0 }} />
                Claude Worktrees
                {claudeWorktrees.length > 0 && (
                  <span style={{
                    color: t.purple, fontSize: 10,
                    background: `${t.purple}15`, border: `1px solid ${t.purple}28`,
                    borderRadius: RADIUS, padding: "1px 6px", ...MONO_FONT,
                  }}>{claudeWorktrees.length}</span>
                )}
                <span style={{ fontSize: 10, color: t.label4 }}>{showWorktrees ? "▾" : "▸"}</span>
              </button>
            </div>
            {wtMsg && (
              <div style={{
                margin: "0 12px 6px", padding: "6px 10px",
                background: `${t.green}10`, border: `1px solid ${t.green}28`,
                borderRadius: RADIUS, color: t.green, fontSize: 11, ...MONO_FONT,
              }}>{wtMsg}</div>
            )}
            {showWorktrees && claudeWorktrees.map((w) => (
              <div key={w.path} style={{
                margin: "0 12px 5px", padding: "8px 12px",
                background: t.surface2, border: `1px solid ${t.borderSubtle}`,
                borderRadius: RADIUS, display: "flex", alignItems: "center", gap: 8,
                transition: "all 0.15s",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: t.label2 }}>{w.repo}</div>
                  <div style={{ fontSize: 10, color: t.purple, ...MONO_FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    ⎇ {w.branch}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveWorktree(w.repo, w.path)}
                  title="Remove worktree"
                  style={{
                    background: `${t.red}10`, border: `1px solid ${t.red}28`,
                    borderRadius: RADIUS, color: t.red,
                    cursor: "pointer", fontSize: 10, fontWeight: 600, padding: "3px 7px",
                    transition: "all 0.15s", flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { const b = e.currentTarget; b.style.background = `${t.red}22`; b.style.borderColor = `${t.red}50`; }}
                  onMouseLeave={(e) => { const b = e.currentTarget; b.style.background = `${t.red}10`; b.style.borderColor = `${t.red}28`; }}
                >✕ Remove</button>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
