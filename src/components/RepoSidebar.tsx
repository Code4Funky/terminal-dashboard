import { useState, useEffect } from "react";
import { useTheme } from "../ThemeContext";
import { SYS_FONT, MONO_FONT, TABULAR } from "../theme";
import {
  panelHeader, panelTitle, sectionLabel, rowState, dot,
  CLIP, CLIP_LEFT, RADIUS_SM, TRANSITION,
} from "../chrome";
import type { DotState } from "../chrome";
import type { TaskSummary } from "../types/tasks";
import type { GhPRNode } from "../hooks/useTerminal";

// ── Terminal tabs ─────────────────────────────────────────────────────────────

export interface TerminalTab {
  id: string;
  number: number;
  title: string;
  cwd?: string;
  gitBranch?: string;
}

interface Props {
  tabs: TerminalTab[];
  focusedId: string | null;
  onFocusTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  /** Dashboard's shared fan-out — feeds the session rows' #PR badges only. */
  prs: GhPRNode[];
  needYouCount: number | null;
  onOpenPRs: () => void;
}

// An agent that has stopped printing but still has work open is waiting on you. The task gate is what
// keeps this off every idle shell, and 10s is above Claude's longest gap between spinner frames.
const SILENT_MS = 10_000;
const LIVE_MS = 3_000;

/** Compact elapsed time for the session rows — "now", "4m", "2h", "3d". */
function shortAgo(epochMs: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

function isBranchTab(title: string): boolean {
  return !title.startsWith("terminal ");
}

/** Sessions panel width — Dashboard reserves the same figure when sizing the right-hand drawers. */
export const SIDEBAR_W = 264;

export function RepoSidebar({
  tabs, focusedId, onFocusTab, onCloseTab, onAddTab, prs, needYouCount, onOpenPRs,
}: Props) {
  const { theme: t } = useTheme();

  // Terminal tab hover
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const [prRowHovered, setPrRowHovered] = useState(false);

  // Panels that have a recorded Claude session — drives the ✳ icon visibility
  const [claudePanelNums, setClaudePanelNums] = useState<Set<number>>(new Set());
  useEffect(() => {
    window.terminal.getAllPanelClaudeSessions().then((map) => {
      setClaudePanelNums(new Set(Object.keys(map).filter((k) => (map[Number(k)] ?? []).length > 0).map(Number)));
    });
    const cleanup = window.terminal.onClaudeSessionRecorded((num) => {
      setClaudePanelNums((prev) => prev.has(num) ? prev : new Set(prev).add(num));
    });
    return cleanup;
  }, []);

  // Task summaries per panel — the only real activity signal, so it drives the status dots
  const [panelTasks, setPanelTasks] = useState<Record<number, TaskSummary>>({});
  useEffect(() => {
    const cleanup = window.terminal.onClaudeTasksUpdated((sum) => {
      const num = sum.panelNumber;
      if (num === null) return; // todo-file summaries aren't bound to a panel
      setPanelTasks((prev) => ({ ...prev, [num]: sum }));
    });
    return cleanup;
  }, []);
  useEffect(() => {
    for (const num of tabs.map((tb) => tb.number)) {
      if (panelTasks[num]) continue;
      window.terminal.getPanelTasks(num).then((list) => {
        if (list.length === 0) return;
        const latest = list.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
        setPanelTasks((prev) => ({ ...prev, [num]: latest }));
      });
    }
  }, [tabs.map((tb) => tb.number).join(",")]);

  // Re-render on a timer so the elapsed times in the rows don't go stale
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Last-output stamps drive the running / needs-input split. Polled only while an agent is open, so
  // a window of plain shells costs nothing.
  const [activity, setActivity] = useState<Record<number, number>>({});
  const hasAgents = tabs.some((tb) => claudePanelNums.has(tb.number));
  useEffect(() => {
    if (!hasAgents) return;
    const poll = () => window.terminal.getActivity().then(setActivity).catch(() => {});
    poll();
    const id = setInterval(poll, 2_000);
    return () => clearInterval(id);
  }, [hasAgents]);

  // Per-repo working tree line stats (adds + dels) for tab cards
  const [repoTabStats, setRepoTabStats] = useState<Record<string, { adds: number; dels: number }>>({});

  // Fetch +/- line totals for repos currently open in tabs
  useEffect(() => {
    const repos = [...new Set(
      tabs
        .map(tab => tab.cwd?.includes("/GitHub/") ? tab.cwd.split("/GitHub/")[1]?.split("/")[0] : null)
        .filter((r): r is string => !!r)
    )];
    if (repos.length === 0) return;
    repos.forEach(repo => {
      window.terminal.getWorkingTree(repo)
        .then(({ staged, unstaged }) => {
          const all = [...staged, ...unstaged];
          const adds = all.reduce((s, f) => s + f.additions, 0);
          const dels = all.reduce((s, f) => s + f.deletions, 0);
          setRepoTabStats(prev => ({ ...prev, [repo]: { adds, dels } }));
        })
        .catch(() => {});
    });
  }, [tabs.map(t => t.cwd).join("|")]);

  return (
    <div
      style={{
        width: SIDEBAR_W, flexShrink: 0,
        background: t.surface1,
        borderRight: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}
    >

      {/* ── SESSIONS section ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={panelHeader(t)}>
          <span style={{ ...panelTitle(t), flex: 1 }}>Sessions</span>
          <button
            onClick={(e) => { e.stopPropagation(); onAddTab(); }}
            title="New terminal (⌘T)"
            aria-label="New terminal"
            style={{
              width: 22, height: 22, flex: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "none", border: "none", borderRadius: RADIUS_SM, cursor: "pointer",
              color: t.label3, fontSize: 15, lineHeight: 1, transition: TRANSITION,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.label1; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.label3; }}
          >+</button>
        </div>

        {/* Cross-link to the PRs panel. Not the footer — Phase 6 reserves that for the status mirror. */}
        <button
          onClick={onOpenPRs}
          onMouseEnter={() => setPrRowHovered(true)}
          onMouseLeave={() => setPrRowHovered(false)}
          style={{
            height: 32, flexShrink: 0, width: "100%",
            display: "flex", alignItems: "center", gap: 7,
            padding: "0 10px 0 12px", textAlign: "left",
            border: "none", borderBottom: `1px solid ${t.borderMid}`,
            cursor: "pointer",
            ...rowState(t, false, prRowHovered),
          }}
        >
          <span style={{ flex: "none", color: t.label4, fontSize: 11 }}>⑃</span>
          <span style={{ flex: "none", color: t.label2, fontSize: 12, ...SYS_FONT }}>Pull requests</span>
          {/* Hidden at 0 as well as while loading — "0 need you" is noise, and the empty label says it. */}
          {needYouCount != null && needYouCount > 0 && (
            <span style={{ flex: "0 1 auto", color: t.blue, fontSize: 11, ...MONO_FONT, ...TABULAR, ...CLIP }}>
              · {needYouCount} need you
            </span>
          )}
          <span style={{ flex: 1, minWidth: 0 }} />
          <span style={{ flex: "none", color: t.label4, fontSize: 12 }}>›</span>
        </button>

        {/* Session rows, grouped by agents vs plain shells */}
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 6 }}>
          {(() => {
            const repoOf = (tab: TerminalTab) =>
              tab.cwd?.includes("/GitHub/") ? (tab.cwd.split("/GitHub/")[1]?.split("/")[0] ?? "") : "";

            // Repo order within a group keeps sessions on the same codebase adjacent
            const byRepo = (a: TerminalTab, b: TerminalTab) => repoOf(a).localeCompare(repoOf(b));
            const agents = tabs.filter((tb) => claudePanelNums.has(tb.number)).sort(byRepo);
            const shells = tabs.filter((tb) => !claudePanelNums.has(tb.number)).sort(byRepo);

            // One chrome, two shapes: an agent's second line carries branch + PR, a shell's carries
            // branch + working-tree ±. Splitting the whole row would have been two copies of the frame.
            const renderRow = (tab: TerminalTab, kind: "agent" | "shell") => {
              const isActive = tab.id === focusedId;
              const isHovered = hoveredTabId === tab.id;
              const gitRepoName = repoOf(tab) || null;
              const summary = panelTasks[tab.number];

              const displayName = (() => {
                if (!tab.title.startsWith("terminal ")) return tab.title;
                if (gitRepoName) return gitRepoName;
                if (!tab.cwd) return "idle";
                const home = tab.cwd.replace(/^\/Users\/[^/]+/, "~");
                if (home === "~") return "idle";
                return tab.cwd.split("/").filter(Boolean).pop() ?? "idle";
              })();

              const tabPR = tab.gitBranch
                ? prs.find((pr) =>
                    pr.headRefName === tab.gitBranch &&
                    (!tab.cwd || tab.cwd.includes(pr.repository.name))
                  ) ?? null
                : null;

              const wtStats = gitRepoName ? repoTabStats[gitRepoName] : null;
              const prStats = tabPR != null ? { adds: tabPR.additions ?? 0, dels: tabPR.deletions ?? 0 } : null;
              const tabStats = (wtStats && (wtStats.adds > 0 || wtStats.dels > 0)) ? wtStats : prStats;

              // A silent PTY with tasks still open means the agent is waiting on you; recent output
              // means it's working. Neither applies to a plain shell, which is always idle.
              const lastData = activity[tab.number];
              const working = kind === "agent" && !!summary && summary.inProgress > 0;
              const silent = lastData != null && Date.now() - lastData >= SILENT_MS;
              const live = lastData != null && Date.now() - lastData < LIVE_MS;
              const state: DotState =
                kind !== "agent" ? "idle"
                : working && silent ? "needs-input"
                : live || working ? "running"
                : "idle";

              const statusText = kind !== "agent" ? null
                : state === "needs-input" ? "needs input"
                : summary
                  ? (summary.inProgress > 0 ? shortAgo(summary.updatedAt)
                    : summary.completed === summary.total ? "done"
                    : `${summary.completed}/${summary.total}`)
                  : null;

              const secondLine = tab.gitBranch
                ? { icon: kind === "agent" ? "⎇" : "⟳", text: tab.gitBranch }
                : tab.cwd
                  ? { icon: "", text: tab.cwd.replace(/^\/Users\/[^/]+/, "~") }
                  : null;

              return (
                <div
                  key={tab.id}
                  onClick={(e) => { e.stopPropagation(); onFocusTab(tab.id); }}
                  onMouseEnter={() => setHoveredTabId(tab.id)}
                  onMouseLeave={() => setHoveredTabId(null)}
                  style={{
                    padding: "6px 10px 6px 12px",
                    cursor: "pointer",
                    ...rowState(t, isActive, isHovered),
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={dot(t, state)} />
                    <span style={{
                      flex: "0 1 auto",
                      color: isActive ? t.label1 : t.label2,
                      fontSize: 13, lineHeight: "18px", fontWeight: isActive ? 600 : 400,
                      ...SYS_FONT, ...CLIP,
                    }}>{displayName}</span>
                    <span style={{ flex: 1, minWidth: 0 }} />
                    {statusText && (
                      <span style={{
                        flex: "none", fontSize: 11,
                        color: state === "needs-input" ? t.orange : state === "running" ? t.green : t.label3,
                        ...MONO_FONT, ...TABULAR,
                      }}>{statusText}</span>
                    )}
                    {(isHovered || isActive) && tabs.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                        title="Close (⌃W)"
                        aria-label={`Close ${displayName}`}
                        style={{
                          width: 16, height: 16, flex: "none",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: "none", border: "none", borderRadius: RADIUS_SM,
                          color: t.label3, cursor: "pointer", fontSize: 13, lineHeight: 1,
                          transition: TRANSITION,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = t.red)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
                      >×</button>
                    )}
                  </div>

                  {secondLine && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2, paddingLeft: 14 }}>
                      {secondLine.icon && <span style={{ color: t.label4, fontSize: 10, flex: "none" }}>{secondLine.icon}</span>}
                      <span
                        title={secondLine.text}
                        style={{
                          flex: "0 1 auto", fontSize: 11, lineHeight: "15px",
                          color: isActive ? t.label2 : t.label3,
                          ...MONO_FONT, ...CLIP_LEFT,
                        }}
                      >{secondLine.text}</span>
                      <span style={{ flex: 1, minWidth: 0 }} />
                      {/* 264px can't hold branch + ± + #PR, so each kind keeps only its own trailing badge */}
                      {kind === "shell" && tabStats && (tabStats.adds > 0 || tabStats.dels > 0) && (
                        <span style={{ flex: "none", display: "flex", gap: 4, fontSize: 10, ...MONO_FONT, ...TABULAR }}>
                          {tabStats.adds > 0 && <span style={{ color: t.diffAddFg }}>+{tabStats.adds}</span>}
                          {tabStats.dels > 0 && <span style={{ color: t.diffDelFg }}>-{tabStats.dels}</span>}
                        </span>
                      )}
                      {kind === "agent" && tabPR && (
                        <span style={{ flex: "none", fontSize: 10, color: t.blue, ...MONO_FONT, ...TABULAR }}>#{tabPR.number}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            };

            return (
              <>
                {agents.length > 0 && (
                  <div style={sectionLabel(t)}>Agents · {agents.length}</div>
                )}
                {agents.map((tab) => renderRow(tab, "agent"))}
                {shells.length > 0 && (
                  <div style={sectionLabel(t)}>Shells · {shells.length}</div>
                )}
                {shells.map((tab) => renderRow(tab, "shell"))}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
