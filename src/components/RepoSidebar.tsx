import { useState, useEffect, useRef } from "react";
import { useTheme } from "../ThemeContext";

// ── Terminal tabs ─────────────────────────────────────────────────────────────

export interface TerminalTab {
  id: string;
  title: string;
  cwd?: string;
  gitBranch?: string;
}

// ── PR selection ──────────────────────────────────────────────────────────────

interface PR {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  headRefOid: string;
  isDraft: boolean;
  createdAt: string;
  reviewDecision: string | null;
  repository: { name: string; nameWithOwner: string };
}

export interface SelectedPR {
  prNumber: number;
  repoName: string;
  prTitle: string;
  branch: string;
  prUrl: string;
}

interface Props {
  // Terminal tabs
  tabs: TerminalTab[];
  focusedId: string | null;
  onFocusTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  // PR/repo
  selected: SelectedPR | null;
  onSelectPR: (sel: SelectedPR | null) => void;
  onOpenTerminal: (repoName: string, branchName: string) => void;
  onRunClaudeAction: (repoName: string, branchName: string, cmd: string) => void;
  onReposLoaded: (repos: { name: string }[]) => void;
  onCheckoutBranch: (repoName: string, branch: string) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) {
    const hours = Math.floor(diff / 3600000);
    return hours === 0 ? "now" : `${hours}h`;
  }
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function prStatus(pr: PR, t: ReturnType<typeof useTheme>["theme"]): { label: string; color: string } {
  if (pr.isDraft) return { label: "Draft", color: t.label4 };
  if (pr.reviewDecision === "APPROVED") return { label: "Approved", color: t.green };
  if (pr.reviewDecision === "CHANGES_REQUESTED") return { label: "Changes", color: t.red };
  return { label: "Needs review", color: t.orange };
}

function isBranchTab(title: string): boolean {
  return !title.startsWith("terminal ");
}

export function RepoSidebar({
  tabs, focusedId, onFocusTab, onCloseTab, onAddTab,
  selected, onSelectPR, onOpenTerminal, onRunClaudeAction, onReposLoaded, onCheckoutBranch,
}: Props) {
  const { theme: t } = useTheme();

  // Terminal tab hover
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);

  // PR data
  const [prs, setPRs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoExpanded, setRepoExpanded] = useState<Record<string, boolean>>({});
  const [hoveredPRKey, setHoveredPRKey] = useState<string | null>(null);
  const [showActionsFor, setShowActionsFor] = useState<string | null>(null);
  const [claudeCooldown, setClaudeCooldown] = useState<Set<string>>(new Set());

  // Branch picker
  const [localBranches, setLocalBranches] = useState<{ repo: string; branch: string }[]>([]);
  const [branchPickerRepo, setBranchPickerRepo] = useState<string | null>(null);
  const [branchSearch, setBranchSearch] = useState("");
  const [branchCursor, setBranchCursor] = useState(0);
  const [repoCurBranch, setRepoCurBranch] = useState<Record<string, string>>({});
  const branchSearchRef = useRef<HTMLInputElement>(null);

  // Add repository modal
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [addRepoUrl, setAddRepoUrl] = useState("");
  const [addRepoStep, setAddRepoStep] = useState<"input" | "cloning" | "done">("input");
  const [addRepoProgress, setAddRepoProgress] = useState("");
  const [addRepoError, setAddRepoError] = useState("");
  const [addRepoDoneName, setAddRepoDoneName] = useState("");
  const addRepoUrlRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<HTMLPreElement>(null);

  const load = () => {
    setLoading(true);
    window.terminal.listPRs().then((data) => {
      setPRs(data);
      setLoading(false);
      setRepoExpanded((prev) => {
        const next = { ...prev };
        for (const pr of data) {
          const key = pr.repository.nameWithOwner;
          if (!(key in next)) next[key] = true;
        }
        return next;
      });
      const repos = [...new Map(data.map((p) => [p.repository.name, { name: p.repository.name }])).values()];
      onReposLoaded(repos);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const loadBranches = () => {
    window.terminal.listLocalBranches().then((data) => setLocalBranches(data)).catch(() => {});
  };
  useEffect(() => { loadBranches(); }, []);

  // Fetch current branch for each repo when picker opens
  useEffect(() => {
    if (!branchPickerRepo) return;
    const repoName = branchPickerRepo.split("/").pop() ?? branchPickerRepo;
    // Try to infer from focused tab first
    const focused = tabs.find((t) => t.id === focusedId);
    if (focused?.gitBranch && focused?.cwd?.includes(`/${repoName}`)) {
      setRepoCurBranch((prev) => ({ ...prev, [repoName]: focused.gitBranch! }));
      return;
    }
    window.terminal.getRepoBranch(repoName).then((b) => {
      if (b) setRepoCurBranch((prev) => ({ ...prev, [repoName]: b }));
    }).catch(() => {});
  }, [branchPickerRepo]);

  // Also update from focused tab CWD changes
  useEffect(() => {
    const focused = tabs.find((t) => t.id === focusedId);
    if (!focused?.gitBranch || !focused.cwd) return;
    const match = focused.cwd.match(/\/Documents\/GitHub\/([^/]+)/);
    if (!match) return;
    const repoName = match[1];
    setRepoCurBranch((prev) => ({ ...prev, [repoName]: focused.gitBranch! }));
  }, [focusedId, tabs]);

  // Auto-scroll clone progress
  useEffect(() => {
    if (progressRef.current) progressRef.current.scrollTop = progressRef.current.scrollHeight;
  }, [addRepoProgress]);

  const byRepo = prs.reduce<Record<string, PR[]>>((acc, pr) => {
    const key = pr.repository.nameWithOwner;
    if (!acc[key]) acc[key] = [];
    acc[key].push(pr);
    return acc;
  }, {});

  const handleClickPR = (pr: PR, repoName: string) => {
    const isSame = selected?.prNumber === pr.number && selected?.repoName === repoName;
    onSelectPR(isSame ? null : { prNumber: pr.number, repoName, prTitle: pr.title, branch: pr.headRefName, prUrl: pr.url });
    setShowActionsFor(null);
  };

  const handleClaudeAction = (repoName: string, branch: string, cmd: string, key: string) => {
    if (claudeCooldown.has(key)) return;
    setClaudeCooldown((p) => new Set(p).add(key));
    onRunClaudeAction(repoName, branch, cmd);
    setTimeout(() => setClaudeCooldown((p) => { const n = new Set(p); n.delete(key); return n; }), 2000);
    setShowActionsFor(null);
  };

  const startClone = () => {
    const url = addRepoUrl.trim();
    if (!url) return;
    const requestId = Math.random().toString(36).slice(2);
    setAddRepoStep("cloning");
    setAddRepoProgress("");
    setAddRepoError("");
    const unProgress = window.terminal.onCloneProgress(requestId, (text) => {
      setAddRepoProgress((p) => p + text);
    });
    const cleanup = () => { unProgress(); unDone(); unError(); };
    const unDone = window.terminal.onCloneDone(requestId, (name) => {
      cleanup();
      setAddRepoDoneName(name);
      setAddRepoStep("done");
      loadBranches();
      load();
    });
    const unError = window.terminal.onCloneError(requestId, (err) => {
      cleanup();
      setAddRepoError(err);
      setAddRepoStep("input");
    });
    window.terminal.cloneRepository(url, requestId);
  };

  const closeAddRepo = () => {
    setShowAddRepo(false);
    setAddRepoUrl("");
    setAddRepoStep("input");
    setAddRepoProgress("");
    setAddRepoError("");
  };

  const hoverBg = t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";

  return (
    <div
      style={{
        width: 240, flexShrink: 0,
        background: t.surface1,
        borderRight: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}
      onClick={() => { setShowActionsFor(null); setBranchPickerRepo(null); }}
    >

      {/* ── TERMINALS section ── */}
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "8px 12px 7px" }}>
          <span style={{
            flex: 1, color: t.label3, fontSize: 10,
            letterSpacing: "0.04em", fontWeight: 600,
          }}>Terminals</span>
        </div>

        {/* Tab rows */}
        {tabs.map((tab) => {
          const isActive = tab.id === focusedId;
          const isHovered = hoveredTabId === tab.id;
          const branch = isBranchTab(tab.title);

          return (
            <div
              key={tab.id}
              onClick={(e) => { e.stopPropagation(); onFocusTab(tab.id); }}
              onMouseEnter={() => setHoveredTabId(tab.id)}
              onMouseLeave={() => setHoveredTabId(null)}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "5px 12px",
                cursor: "pointer",
                background: isActive ? `${t.blue}15` : isHovered ? hoverBg : "transparent",
                borderLeft: `2px solid ${isActive ? t.blue : "transparent"}`,
              }}
            >
              <span style={{ color: branch ? t.green : t.label4, fontSize: branch ? 8 : 10, flexShrink: 0 }}>
                {branch ? "⬤" : "⬡"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: isActive ? t.label1 : t.label2,
                  fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {tab.title}
                </div>
                {tab.gitBranch && (
                  <div style={{
                    color: t.teal, fontSize: 9, fontFamily: "monospace",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    ⎇ {tab.gitBranch}
                  </div>
                )}
              </div>
              {(isHovered || isActive) && tabs.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: t.label4, fontSize: 13, padding: "0 1px", lineHeight: 1, flexShrink: 0,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = t.red)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                >×</button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── REPOSITORIES section ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "8px 12px 7px", flexShrink: 0 }}>
          <span style={{
            flex: 1, color: t.label3, fontSize: 10,
            letterSpacing: "0.04em", fontWeight: 600,
          }}>Repositories</span>
          <button
            onClick={(e) => { e.stopPropagation(); load(); }}
            title="Refresh"
            style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 13, padding: "1px 4px", lineHeight: 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.label2)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
          >↺</button>
          <button
            onClick={(e) => { e.stopPropagation(); setShowAddRepo(true); setTimeout(() => addRepoUrlRef.current?.focus(), 50); }}
            title="Add repository"
            style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 15, padding: "1px 4px", lineHeight: 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.green)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
          >+</button>
        </div>

        {/* Add repository modal */}
        {showAddRepo && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed", inset: 0, zIndex: 200,
              background: "rgba(0,0,0,0.5)",
              backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
              display: "flex", alignItems: "flex-start", justifyContent: "center",
              paddingTop: 80,
            }}
            onKeyDown={(e) => { if (e.key === "Escape") closeAddRepo(); }}
          >
            <div style={{
              width: 380, background: t.surface1,
              border: `1px solid ${t.border}`, borderRadius: 14,
              padding: "20px 22px", boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
            }}>
              {/* Title */}
              <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
                <span style={{ flex: 1, color: t.label1, fontWeight: 700, fontSize: 14 }}>Add repository</span>
                <button
                  onClick={closeAddRepo}
                  style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 16, lineHeight: 1, padding: "0 2px" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                >×</button>
              </div>

              {/* Step 1: input */}
              {addRepoStep === "input" && (
                <>
                  <div style={{ marginBottom: 10, color: t.label3, fontSize: 11 }}>
                    GitHub URL or local path to clone into <span style={{ color: t.teal, fontFamily: "monospace" }}>~/Documents/GitHub/</span>
                  </div>
                  <input
                    ref={addRepoUrlRef}
                    value={addRepoUrl}
                    onChange={(e) => { setAddRepoUrl(e.target.value); setAddRepoError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") startClone(); }}
                    placeholder="https://github.com/org/repo"
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: t.surface2, border: `1px solid ${addRepoError ? t.red : t.border}`,
                      borderRadius: 7, color: t.label1, fontSize: 12, fontFamily: "monospace",
                      padding: "8px 10px", outline: "none", marginBottom: addRepoError ? 6 : 14,
                    }}
                  />
                  {addRepoError && (
                    <div style={{ color: t.red, fontSize: 11, marginBottom: 12, fontFamily: "monospace", wordBreak: "break-word" }}>
                      {addRepoError}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      onClick={closeAddRepo}
                      style={{
                        background: t.surface2, border: `1px solid ${t.border}`,
                        borderRadius: 7, color: t.label2, cursor: "pointer",
                        fontSize: 12, fontWeight: 600, padding: "6px 16px",
                      }}
                    >Cancel</button>
                    <button
                      onClick={startClone}
                      disabled={!addRepoUrl.trim()}
                      style={{
                        background: addRepoUrl.trim() ? t.green : t.surface2,
                        border: "none", borderRadius: 7,
                        color: addRepoUrl.trim() ? "#fff" : t.label4,
                        cursor: addRepoUrl.trim() ? "pointer" : "default",
                        fontSize: 12, fontWeight: 700, padding: "6px 18px",
                        opacity: addRepoUrl.trim() ? 1 : 0.5,
                      }}
                    >Add repository</button>
                  </div>
                </>
              )}

              {/* Step 2: cloning */}
              {addRepoStep === "cloning" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: t.label2, fontSize: 12 }}>
                    <span style={{ color: t.teal, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{addRepoUrl}</span>
                  </div>
                  <pre
                    ref={progressRef}
                    style={{
                      background: t.surface2, border: `1px solid ${t.border}`,
                      borderRadius: 7, padding: "8px 10px",
                      color: t.label2, fontSize: 10, fontFamily: "monospace",
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                      maxHeight: 180, overflowY: "auto", margin: 0,
                    }}
                  >{addRepoProgress || "Cloning…"}</pre>
                </>
              )}

              {/* Step 3: done */}
              {addRepoStep === "done" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <span style={{ color: t.green, fontSize: 18 }}>✓</span>
                    <span style={{ color: t.label1, fontSize: 13 }}>
                      Cloned <span style={{ color: t.green, fontFamily: "monospace" }}>{addRepoDoneName}</span>
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={closeAddRepo}
                      style={{
                        background: t.green, border: "none", borderRadius: 7,
                        color: "#fff", cursor: "pointer",
                        fontSize: 12, fontWeight: 700, padding: "6px 20px",
                      }}
                    >Done</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* PR list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && (
            <div style={{ padding: "12px 16px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>Loading…</div>
          )}

          {!loading && Object.keys(byRepo).length === 0 && (
            <div style={{ padding: "12px 16px", color: t.label4, fontSize: 11 }}>No open PRs</div>
          )}

          {!loading && Object.entries(byRepo)
            .sort((a, b) => b[1].length - a[1].length)
            .map(([repoFullName, repoPRs]) => {
              const repoName = repoFullName.split("/").pop() ?? repoFullName;
              const isExpanded = repoExpanded[repoFullName] !== false;

              const curBranch = repoCurBranch[repoName];
              const isPickerOpen = branchPickerRepo === repoFullName;
              const prBranchSet = new Set(repoPRs.map((p) => p.headRefName));
              const repoBranches = localBranches.filter((b) => b.repo === repoName && b.branch !== curBranch);
              const filteredBranches = branchSearch
                ? repoBranches.filter((b) => b.branch.toLowerCase().includes(branchSearch.toLowerCase()))
                : repoBranches;
              const recentBranches = filteredBranches.filter((b) => prBranchSet.has(b.branch));
              const otherBranches = filteredBranches.filter((b) => !prBranchSet.has(b.branch));
              const allPickerItems = [
                ...recentBranches.map((b) => b.branch),
                ...otherBranches.map((b) => b.branch),
              ];

              return (
                <div key={repoFullName}>
                  {/* Repo header */}
                  <div
                    onClick={(e) => { e.stopPropagation(); setRepoExpanded((p) => ({ ...p, [repoFullName]: !p[repoFullName] })); }}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hoverBg)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{ color: t.label4, fontSize: 9, width: 8, flexShrink: 0 }}>{isExpanded ? "▼" : "▶"}</span>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill={t.label3} style={{ flexShrink: 0 }}>
                      <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z" />
                    </svg>
                    <span style={{
                      flex: 1, color: t.label1, fontSize: 12, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{repoName}</span>
                    <span style={{
                      fontSize: 10, color: t.label3, background: t.surface2,
                      borderRadius: 10, padding: "1px 5px", fontFamily: "monospace", flexShrink: 0,
                    }}>{repoPRs.length}</span>
                  </div>

                  {/* Branch picker trigger */}
                  {isExpanded && (
                    <div style={{ padding: "2px 12px 4px 26px" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          if (isPickerOpen) { setBranchPickerRepo(null); return; }
                          setBranchPickerRepo(repoFullName);
                          setBranchSearch("");
                          setBranchCursor(0);
                          setTimeout(() => branchSearchRef.current?.focus(), 30);
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: 5, width: "100%",
                          background: isPickerOpen ? `${t.green}18` : `${t.surface2}80`,
                          border: `1px solid ${isPickerOpen ? t.green + "50" : t.border}`,
                          borderRadius: 5, color: isPickerOpen ? t.green : t.teal,
                          cursor: "pointer", fontSize: 10, fontFamily: "monospace",
                          padding: "3px 7px", textAlign: "left",
                        }}
                      >
                        <span style={{ fontSize: 9, flexShrink: 0 }}>ᵍ°</span>
                        <span style={{
                          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{curBranch ?? "select branch"}</span>
                        <span style={{ fontSize: 8, color: t.label4, flexShrink: 0 }}>{isPickerOpen ? "∧" : "∨"}</span>
                      </button>
                    </div>
                  )}

                  {/* Branch picker dropdown */}
                  {isExpanded && isPickerOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        margin: "2px 8px 6px",
                        background: t.surface2,
                        border: `1px solid ${t.border}`,
                        borderRadius: 7, overflow: "hidden",
                      }}
                    >
                      {/* Search row */}
                      <div style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "5px 8px", borderBottom: `1px solid ${t.border}`,
                      }}>
                        <span style={{ color: t.label4, fontSize: 11 }}>⌕</span>
                        <input
                          ref={branchSearchRef}
                          value={branchSearch}
                          onChange={(e) => { setBranchSearch(e.target.value); setBranchCursor(0); }}
                          onKeyDown={(e) => {
                            if (e.key === "ArrowDown") { e.preventDefault(); setBranchCursor((c) => Math.min(c + 1, allPickerItems.length - 1)); }
                            else if (e.key === "ArrowUp") { e.preventDefault(); setBranchCursor((c) => Math.max(c - 1, 0)); }
                            else if (e.key === "Enter") {
                              const b = allPickerItems[branchCursor];
                              if (b) { onCheckoutBranch(repoName, b); setBranchPickerRepo(null); }
                            } else if (e.key === "Escape") { setBranchPickerRepo(null); }
                          }}
                          placeholder="Search branches"
                          style={{
                            flex: 1, background: "none", border: "none", outline: "none",
                            color: t.label1, fontSize: 11, fontFamily: "monospace",
                          }}
                        />
                      </div>

                      {/* Current branch */}
                      {curBranch && (
                        <div style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "4px 10px",
                        }}>
                          <span style={{ color: t.green, fontSize: 10, width: 10, flexShrink: 0 }}>✓</span>
                          <span style={{ color: t.label4, fontSize: 9, flexShrink: 0 }}>ᵍ°</span>
                          <span style={{ color: t.green, fontSize: 11, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{curBranch}</span>
                        </div>
                      )}

                      {/* Branch list */}
                      <div style={{ maxHeight: 180, overflowY: "auto" }}>
                        {recentBranches.length > 0 && (
                          <>
                            <div style={{ padding: "3px 10px 2px", color: t.label4, fontSize: 9, letterSpacing: "0.06em", fontWeight: 600 }}>RECENT</div>
                            {recentBranches.map((b, i) => {
                              const isActive = branchCursor === i;
                              return (
                                <div
                                  key={b.branch}
                                  onMouseEnter={() => setBranchCursor(i)}
                                  onClick={() => { onCheckoutBranch(repoName, b.branch); setBranchPickerRepo(null); }}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 6,
                                    padding: "4px 10px", cursor: "pointer",
                                    background: isActive ? `${t.blue}22` : "transparent",
                                  }}
                                >
                                  <span style={{ color: t.label4, fontSize: 9, flexShrink: 0 }}>ᵍ°</span>
                                  <span style={{
                                    color: t.label2, fontSize: 11, fontFamily: "monospace",
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                  }}>{b.branch}</span>
                                </div>
                              );
                            })}
                          </>
                        )}
                        {otherBranches.length > 0 && (
                          <>
                            <div style={{ padding: "3px 10px 2px", color: t.label4, fontSize: 9, letterSpacing: "0.06em", fontWeight: 600 }}>ALL</div>
                            {otherBranches.map((b, i) => {
                              const idx = recentBranches.length + i;
                              const isActive = branchCursor === idx;
                              return (
                                <div
                                  key={b.branch}
                                  onMouseEnter={() => setBranchCursor(idx)}
                                  onClick={() => { onCheckoutBranch(repoName, b.branch); setBranchPickerRepo(null); }}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 6,
                                    padding: "4px 10px", cursor: "pointer",
                                    background: isActive ? `${t.blue}22` : "transparent",
                                  }}
                                >
                                  <span style={{ color: t.label4, fontSize: 9, flexShrink: 0 }}>ᵍ°</span>
                                  <span style={{
                                    color: t.label2, fontSize: 11, fontFamily: "monospace",
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                  }}>{b.branch}</span>
                                </div>
                              );
                            })}
                          </>
                        )}
                        {allPickerItems.length === 0 && (
                          <div style={{ padding: "8px 10px", color: t.label4, fontSize: 11 }}>No branches found</div>
                        )}
                      </div>

                      {/* Footer hints */}
                      <div style={{
                        borderTop: `1px solid ${t.border}`,
                        padding: "3px 10px",
                        display: "flex", gap: 14,
                        color: t.label4, fontSize: 9,
                      }}>
                        <span><span style={{ color: t.label2 }}>↑↓</span> navigate</span>
                        <span><span style={{ color: t.label2 }}>↵</span> checkout</span>
                      </div>
                    </div>
                  )}

                  {/* PR rows */}
                  {isExpanded && repoPRs.map((pr) => {
                    const hKey = `${repoFullName}:${pr.number}`;
                    const isSelected = selected?.prNumber === pr.number && selected?.repoName === repoName;
                    const isHovered = hoveredPRKey === hKey;
                    const showActions = showActionsFor === hKey;
                    const { label: statusLabel, color: statusColor } = prStatus(pr, t);

                    return (
                      <div key={pr.number}>
                        <div
                          onClick={(e) => { e.stopPropagation(); handleClickPR(pr, repoName); }}
                          onMouseEnter={() => setHoveredPRKey(hKey)}
                          onMouseLeave={() => setHoveredPRKey(null)}
                          style={{
                            padding: "5px 12px 5px 26px", cursor: "pointer",
                            background: isSelected ? `${t.blue}18` : isHovered ? hoverBg : "transparent",
                            borderLeft: `2px solid ${isSelected ? t.blue : "transparent"}`,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                            <span style={{ color: t.label3, fontSize: 10, fontFamily: "monospace", flexShrink: 0 }}>#{pr.number}</span>
                            <span style={{
                              fontSize: 9, color: statusColor,
                              background: `${statusColor}18`,
                              border: `1px solid ${statusColor}30`,
                              borderRadius: 3, padding: "0px 4px",
                              fontWeight: 600, flexShrink: 0, lineHeight: 1.6,
                            }}>{statusLabel}</span>
                            <div style={{ flex: 1 }} />
                            {isHovered && (
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setShowActionsFor(showActions ? null : hKey); }}
                                  title="Claude actions"
                                  style={{
                                    background: showActions ? `${t.green}18` : "none",
                                    border: `1px solid ${showActions ? `${t.green}40` : "transparent"}`,
                                    borderRadius: 3, color: showActions ? t.green : t.label4,
                                    cursor: "pointer", fontSize: 10, padding: "0px 3px", lineHeight: 1.4,
                                  }}
                                >⬡</button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onOpenTerminal(repoName, pr.headRefName); }}
                                  title="Open terminal"
                                  style={{
                                    background: `${t.teal}15`, border: `1px solid ${t.teal}30`,
                                    borderRadius: 3, color: t.teal,
                                    cursor: "pointer", fontSize: 9, padding: "1px 4px", lineHeight: 1,
                                  }}
                                >⌨</button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); window.terminal.openExternal(pr.url); }}
                                  title="Open PR in GitHub"
                                  style={{
                                    background: `${t.blue}15`, border: `1px solid ${t.blue}30`,
                                    borderRadius: 3, color: t.blue,
                                    cursor: "pointer", fontSize: 9, padding: "1px 4px", lineHeight: 1,
                                  }}
                                >↗</button>
                              </>
                            )}
                            <span style={{ color: t.label4, fontSize: 9, flexShrink: 0 }}>{timeAgo(pr.createdAt)}</span>
                          </div>
                          <div
                            title={pr.title}
                            style={{
                              color: isSelected ? t.label1 : t.label2,
                              fontSize: 11, lineHeight: 1.4,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}
                          >
                            {pr.title}
                          </div>
                        </div>

                        {/* Claude actions micro-panel */}
                        {showActions && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{ padding: "4px 12px 6px 26px", background: t.isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)" }}
                          >
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                              {([
                                { label: "PR Comments", icon: "✏", cmd: `claude "/pr-comments"`, color: t.orange },
                                { label: "CodeRabbit",  icon: "◈", cmd: `claude "/action-coderabbit ${pr.number}"`, color: t.purple },
                                { label: "Review",      icon: "◎", cmd: `claude "/review"`, color: t.blue },
                                { label: "PR Fixer",    icon: "⚙", cmd: `claude "/pr-fixer"`, color: t.green },
                              ] as const).map(({ label, icon, cmd, color }) => {
                                const cKey = `${hKey}:${label}`;
                                const busy = claudeCooldown.has(cKey);
                                return (
                                  <button
                                    key={label}
                                    onClick={() => handleClaudeAction(repoName, pr.headRefName, cmd, cKey)}
                                    disabled={busy}
                                    style={{
                                      display: "flex", alignItems: "center", gap: 4,
                                      background: `${color}10`, border: `1px solid ${color}28`,
                                      borderRadius: 5, color,
                                      cursor: busy ? "not-allowed" : "pointer",
                                      fontSize: 9, fontWeight: 600, padding: "4px 6px",
                                      opacity: busy ? 0.5 : 1,
                                    }}
                                  >
                                    <span style={{ fontSize: 10 }}>{busy ? "⟳" : icon}</span>
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          {/* Add repository row */}
          <div
            onClick={(e) => { e.stopPropagation(); setShowAddRepo(true); setTimeout(() => addRepoUrlRef.current?.focus(), 50); }}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 12px", cursor: "pointer",
              borderTop: `1px solid ${t.border}`,
              color: t.label4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = t.green; e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = t.label4; e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}>+</span>
            <span style={{ fontSize: 11 }}>Add repository…</span>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          borderTop: `1px solid ${t.border}`, padding: "7px 12px",
          display: "flex", alignItems: "center", gap: 6,
          color: t.label2, fontSize: 10, flexShrink: 0,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: loading ? t.orange : t.green,
            flexShrink: 0, display: "inline-block",
          }} />
          {loading ? "Loading…" : `${prs.length} open PR${prs.length !== 1 ? "s" : ""}`}
        </div>
      </div>
    </div>
  );
}
