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
  author?: { login: string };
  additions?: number;
  deletions?: number;
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
  onOpenRepoTerminal: (repoName: string) => void;
  onSelectRepoTree: (repoName: string) => void;
  onRunClaudeAction: (repoName: string, branchName: string, cmd: string) => void;
  onReposLoaded: (repos: { name: string }[]) => void;
  onCheckoutBranch: (repoName: string, branch: string) => void;
  onBrowseFiles: (repoName: string) => void;
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

interface CICheck {
  __typename: string;
  name?: string;
  context?: string;
  status: string;
  conclusion: string | null;
  startedAt: string;
  completedAt: string | null;
  url: string;
}

function aggregateCIChecks(checks: CICheck[]): "success" | "failure" | "pending" | "unknown" {
  if (checks.length === 0) return "unknown";
  if (checks.some(c => c.conclusion === "FAILURE" || c.conclusion === "TIMED_OUT" || c.conclusion === "ACTION_REQUIRED")) return "failure";
  if (checks.some(c => c.status === "IN_PROGRESS" || c.status === "QUEUED" || c.status === "WAITING" || c.status === "PENDING")) return "pending";
  if (checks.every(c => c.conclusion === "SUCCESS" || c.conclusion === "NEUTRAL" || c.conclusion === "SKIPPED")) return "success";
  return "unknown";
}

export function RepoSidebar({
  tabs, focusedId, onFocusTab, onCloseTab, onAddTab,
  selected, onSelectPR, onOpenTerminal, onOpenRepoTerminal, onSelectRepoTree, onRunClaudeAction, onReposLoaded, onCheckoutBranch, onBrowseFiles,
}: Props) {
  const { theme: t } = useTheme();

  // Terminal tab hover
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const [idleGroupExpanded, setIdleGroupExpanded] = useState(false);

  // Resizable split between TERMINALS and REPOSITORIES
  const [terminalHeight, setTerminalHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("tdash:terminal-section-height");
      if (saved) return Math.max(80, parseInt(saved, 10));
    } catch {}
    return Math.round(window.innerHeight * 0.40);
  });
  const splitDragRef = useRef<{ startY: number; startH: number; last: number } | null>(null);
  const onSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    splitDragRef.current = { startY: e.clientY, startH: terminalHeight, last: terminalHeight };
    const onMove = (ev: MouseEvent) => {
      if (!splitDragRef.current) return;
      const delta = ev.clientY - splitDragRef.current.startY;
      const next = Math.max(80, Math.min(window.innerHeight - 120, splitDragRef.current.startH + delta));
      splitDragRef.current.last = next;
      setTerminalHeight(next);
    };
    const onUp = () => {
      if (splitDragRef.current) {
        try { localStorage.setItem("tdash:terminal-section-height", String(splitDragRef.current.last)); } catch {}
      }
      splitDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // PR data
  const [prs, setPRs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [prFilter, setPrFilter] = useState<"all" | "mine" | "review" | "approved">("all");
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [repoExpanded, setRepoExpanded] = useState<Record<string, boolean>>({});
  const [hoveredPRKey, setHoveredPRKey] = useState<string | null>(null);
  const [copiedBranchKey, setCopiedBranchKey] = useState<string | null>(null);
  const [hoveredRepoKey, setHoveredRepoKey] = useState<string | null>(null);
  const [claudeCooldown, setClaudeCooldown] = useState<Set<string>>(new Set());

  // Pinned repos — persisted to localStorage
  const [pinnedRepos, setPinnedRepos] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("tdash:pinned-repos");
      return new Set(saved ? JSON.parse(saved) : []);
    } catch { return new Set(); }
  });

  const togglePin = (repoName: string) => {
    setPinnedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoName)) next.delete(repoName); else next.add(repoName);
      localStorage.setItem("tdash:pinned-repos", JSON.stringify([...next]));
      return next;
    });
  };

  // CI status per PR number
  const [ciChecks, setCIChecks] = useState<Record<number, CICheck[]>>({});

  // All local repos (including those without open PRs)
  const [allLocalRepos, setAllLocalRepos] = useState<string[]>([]);

  // Change counts (for pill badge)
  const [repoChangeCounts, setRepoChangeCounts] = useState<Record<string, number>>({});

  // Per-repo working tree line stats (adds + dels) for tab cards
  const [repoTabStats, setRepoTabStats] = useState<Record<string, { adds: number; dels: number }>>({});

  // PR lookup cache for tab branches not covered by the main prs list (e.g. other-author PRs)
  const [tabPRCache, setTabPRCache] = useState<Record<string, PR>>({});


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
  const [showNoPRRepos, setShowNoPRRepos] = useState(() => pinnedRepos.size === 0);
  const [repoSearch, setRepoSearch] = useState("");
  const addRepoUrlRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<HTMLPreElement>(null);

  const loadCI = (prs: PR[]) => {
    if (prs.length === 0) return;
    Promise.all(
      prs.map(pr =>
        window.terminal.getCIStatus(pr.repository.nameWithOwner, pr.number)
          .then(checks => ({ prNumber: pr.number, checks }))
          .catch(() => ({ prNumber: pr.number, checks: [] as CICheck[] }))
      )
    ).then(results => {
      setCIChecks(prev => {
        const next = { ...prev };
        results.forEach(({ prNumber, checks }) => { next[prNumber] = checks; });
        return next;
      });
    });
  };

  const load = () => {
    setLoading(true);
    window.terminal.listPRs([...pinnedRepos]).then((data) => {
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
      window.terminal.listGithubRepos().then((localRepos) => {
        const names = localRepos.map(r => r.name);
        setAllLocalRepos(names);
        const allNames = [...new Set([...data.map((p) => p.repository.name), ...names])];
        onReposLoaded(allNames.map(name => ({ name })));
      }).catch(() => {
        const repos = [...new Map(data.map((p) => [p.repository.name, { name: p.repository.name }])).values()];
        onReposLoaded(repos);
      });
      // Load change counts for all repos with PRs
      const repoNames = [...new Set(data.map((p) => p.repository.name))];
      Promise.all(repoNames.map(async (name) => {
        const count = await window.terminal.getChangeCount(name).catch(() => 0);
        return { name, count };
      })).then((results) => {
        const counts: Record<string, number> = {};
        results.forEach(({ name, count }) => { counts[name] = count; });
        setRepoChangeCounts(counts);
      });
      loadCI(data);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { window.terminal.getGhLogin().then(setGhLogin).catch(() => {}); }, []);
  useEffect(() => { if (pinnedRepos.size > 0) load(); }, [[...pinnedRepos].sort().join(",")]);
  useEffect(() => {
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const interval = setInterval(() => {
      setPRs(prev => {
        // Only re-poll PRs whose CI is still in a non-terminal state
        const pending = prev.filter(pr => {
          const checks = ciChecks[pr.number];
          if (!checks) return true; // not yet loaded
          const state = aggregateCIChecks(checks);
          return state === "pending";
        });
        loadCI(pending);
        return prev;
      });
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [ciChecks]);

  const loadBranches = () => {
    window.terminal.listLocalBranches().then((data) => setLocalBranches(data)).catch(() => {});
  };
  useEffect(() => { loadBranches(); }, []);

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

  // Fetch PRs for tab branches not already in the main prs list (handles other-author PRs)
  useEffect(() => {
    const tabKey = tabs.map(t => `${t.cwd}:${t.gitBranch}`).join("|");
    if (!tabKey) return;
    const pairs = tabs
      .map(tab => ({
        repo: tab.cwd?.includes("/GitHub/") ? tab.cwd.split("/GitHub/")[1]?.split("/")[0] : null,
        branch: tab.gitBranch ?? null,
      }))
      .filter((p): p is { repo: string; branch: string } => !!p.repo && !!p.branch);
    // Only fetch for branches not already resolved
    const missing = pairs.filter(p =>
      !prs.some(pr => pr.repository.name === p.repo && pr.headRefName === p.branch) &&
      !tabPRCache[`${p.repo}:${p.branch}`]
    );
    const reposToFetch = [...new Set(missing.map(p => p.repo))];
    reposToFetch.forEach(repo => {
      window.terminal.listPRs([repo]).then(data => {
        data.forEach(pr => {
          const key = `${pr.repository.name}:${pr.headRefName}`;
          setTabPRCache(prev => ({ ...prev, [key]: pr }));
        });
      }).catch(() => {});
    });
  }, [tabs.map(t => `${t.cwd}:${t.gitBranch}`).join("|"), prs.length]);


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

  const filteredPRs = prs.filter(pr => {
    if (prFilter === "mine") return ghLogin ? pr.author?.login === ghLogin : true;
    if (prFilter === "review") return !pr.isDraft && pr.reviewDecision !== "APPROVED" && pr.reviewDecision !== "CHANGES_REQUESTED";
    if (prFilter === "approved") return pr.reviewDecision === "APPROVED";
    return true;
  });

  const byRepo = filteredPRs.reduce<Record<string, PR[]>>((acc, pr) => {
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
      <div style={{ height: terminalHeight, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "7px 12px 5px" }}>
          <span style={{
            flex: 1, color: t.label4, fontSize: 9,
            letterSpacing: "0.06em", fontWeight: 700, textTransform: "uppercase" as const,
          }}>Terminals</span>
          <button
            onClick={(e) => { e.stopPropagation(); onAddTab(); }}
            title="New terminal (⌘T)"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: t.label4, fontSize: 14, padding: "0 3px", lineHeight: 1,
              transition: "color 0.13s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.blue)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
          >+</button>
        </div>

        {/* Tab cards */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 6px" }}>
          {(() => {
            // Split tabs: idle = at ~, no branch, default name
            const isIdleTab = (tab: TerminalTab) => {
              if (!tab.title.startsWith("terminal ")) return false;
              if (tab.gitBranch) return false;
              if (tab.cwd?.includes("/GitHub/")) return false;
              if (!tab.cwd) return true;
              return tab.cwd.replace(/^\/Users\/[^/]+/, "~") === "~";
            };
            const idleTabs = tabs.filter(isIdleTab);
            const activeTabs = tabs.filter(t => !isIdleTab(t));
            return (<>
          {activeTabs.map((tab) => {
            const isActive = tab.id === focusedId;
            const isHovered = hoveredTabId === tab.id;

            // Short path: last 2 components
            const shortPath = (() => {
              if (!tab.cwd) return null;
              const home = tab.cwd.replace(/^\/Users\/[^/]+/, "~");
              const parts = home.split("/").filter(Boolean);
              if (parts.length <= 2) return home;
              return parts.slice(-2).join("/");
            })();

            // Repo name — only trust the path if it's under GitHub dir
            const gitRepoName = tab.cwd?.includes("/GitHub/")
              ? tab.cwd.split("/GitHub/")[1]?.split("/")[0]
              : null;

            // Auto-display name: repo name > folder name > "idle"
            const displayName = (() => {
              if (!tab.title.startsWith("terminal ")) return tab.title;
              if (gitRepoName) return gitRepoName;
              if (!tab.cwd) return "idle";
              const home = tab.cwd.replace(/^\/Users\/[^/]+/, "~");
              if (home === "~") return "idle";
              return tab.cwd.split("/").filter(Boolean).pop() ?? "idle";
            })();

            // Matching PR: check main prs list first, then per-tab cache (handles other-author PRs)
            const cacheKey = gitRepoName && tab.gitBranch ? `${gitRepoName}:${tab.gitBranch}` : null;
            const tabPR = tab.gitBranch
              ? (prs.find(pr =>
                  pr.headRefName === tab.gitBranch &&
                  (!tab.cwd || tab.cwd.includes(pr.repository.name))
                ) ?? (cacheKey ? tabPRCache[cacheKey] : null) ?? null)
              : null;

            const changeCount = gitRepoName ? (repoChangeCounts[gitRepoName] ?? 0) : 0;
            const wtStats = gitRepoName ? repoTabStats[gitRepoName] : null;
            // Show working tree stats if dirty, otherwise show PR total diff
            const prStats = tabPR != null ? { adds: tabPR.additions ?? 0, dels: tabPR.deletions ?? 0 } : null;
            const tabStats = (wtStats && (wtStats.adds > 0 || wtStats.dels > 0)) ? wtStats : prStats;

            return (
              <div
                key={tab.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onFocusTab(tab.id);
                }}
                onMouseEnter={() => setHoveredTabId(tab.id)}
                onMouseLeave={() => setHoveredTabId(null)}
                style={{
                  borderRadius: 8,
                  padding: "8px 10px",
                  marginTop: 3,
                  cursor: "pointer",
                  background: isActive
                    ? t.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"
                    : isHovered ? hoverBg : "transparent",
                  border: `1px solid ${isActive ? t.borderMid : "transparent"}`,
                  transition: "background 0.12s, border-color 0.12s",
                  position: "relative" as const,
                }}
              >
                {/* Row 1: icon + title + close */}
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {/* Claude-style asterisk icon */}
                  <span style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                    background: isActive ? "#e8510020" : t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                    border: `1px solid ${isActive ? "#e8510040" : t.borderSubtle}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, color: isActive ? "#e85100" : t.label3,
                    transition: "all 0.12s",
                  }}>✳</span>

                  <span style={{
                    flex: 1, minWidth: 0,
                    color: isActive ? t.label1 : t.label2,
                    fontSize: 12, fontWeight: isActive ? 600 : 400,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
                  }}>
                    {displayName}
                  </span>

                  {(isHovered || isActive) && tabs.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: t.label4, fontSize: 13, padding: "0 1px", lineHeight: 1, flexShrink: 0,
                        transition: "color 0.12s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = t.red)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                    >×</button>
                  )}
                </div>

                {/* Row 2: path */}
                {shortPath && (
                  <div style={{
                    marginTop: 3, paddingLeft: 29,
                    color: t.label4, fontSize: 10, fontFamily: "monospace",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{shortPath}</div>
                )}

                {/* Row 3: branch */}
                {tab.gitBranch && (
                  <div style={{
                    marginTop: 3, paddingLeft: 29,
                    display: "flex", alignItems: "center", gap: 6,
                    overflow: "hidden",
                  }}>
                    <span style={{ color: t.label4, fontSize: 9, flexShrink: 0 }}>⎇</span>
                    <span style={{
                      fontSize: 9, fontFamily: "monospace",
                      color: isActive ? t.teal : t.label3,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      flex: 1, minWidth: 0,
                    }}>{tab.gitBranch}</span>
                  </div>
                )}

                {/* Row 4: diff stats + PR number */}
                {(tabStats || tabPR) && (
                  <div style={{
                    marginTop: 4, paddingLeft: 29,
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    {tabStats && (tabStats.adds > 0 || tabStats.dels > 0) && (
                      <span style={{ fontFamily: "monospace", fontSize: 10, display: "flex", gap: 4 }}>
                        {tabStats.adds > 0 && (
                          <span style={{ color: t.green, fontWeight: 600 }}>+{tabStats.adds}</span>
                        )}
                        {tabStats.dels > 0 && (
                          <span style={{ color: t.red, fontWeight: 600 }}>-{tabStats.dels}</span>
                        )}
                      </span>
                    )}
                    {tabPR && (
                      <span style={{
                        fontSize: 9, fontFamily: "monospace", color: t.blue,
                        display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                      }}>
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                        </svg>
                        #{tabPR.number}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {/* Idle terminal group */}
          {idleTabs.length > 0 && (
            <div style={{ marginTop: 3 }}>
              <div
                onClick={(e) => { e.stopPropagation(); setIdleGroupExpanded(v => !v); }}
                onMouseEnter={() => setHoveredTabId("__idle__")}
                onMouseLeave={() => setHoveredTabId(null)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 10px", borderRadius: 8, cursor: "pointer",
                  background: hoveredTabId === "__idle__" ? hoverBg : "transparent",
                }}
              >
                <span style={{ color: t.label4, fontSize: 9, width: 8, flexShrink: 0 }}>
                  {idleGroupExpanded ? "▾" : "▸"}
                </span>
                <span style={{ flex: 1, color: t.label3, fontSize: 11, fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" }}>
                  {idleTabs.length} idle terminal{idleTabs.length !== 1 ? "s" : ""}
                </span>
                {idleTabs.length > 1 && tabs.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); idleTabs.forEach(tab => onCloseTab(tab.id)); }}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: t.label4, fontSize: 10, padding: "1px 4px",
                      fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = t.red)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                  >close all</button>
                )}
              </div>
              {idleGroupExpanded && idleTabs.map((tab) => (
                <div
                  key={tab.id}
                  onClick={(e) => { e.stopPropagation(); onFocusTab(tab.id); }}
                  onMouseEnter={() => setHoveredTabId(tab.id)}
                  onMouseLeave={() => setHoveredTabId(null)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "4px 10px 4px 22px", borderRadius: 6, cursor: "pointer",
                    background: tab.id === focusedId
                      ? (t.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)")
                      : hoveredTabId === tab.id ? hoverBg : "transparent",
                  }}
                >
                  <span style={{
                    flex: 1, color: t.label4, fontSize: 10, fontFamily: "monospace",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {tab.title} · ~
                  </span>
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 13, padding: "0 1px", lineHeight: 1 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = t.red)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                    >×</button>
                  )}
                </div>
              ))}
            </div>
          )}
          </>);
          })()}
        </div>
      </div>

      {/* ── Drag handle ── */}
      <div
        onMouseDown={onSplitMouseDown}
        style={{
          height: 5, flexShrink: 0, cursor: "row-resize",
          background: "transparent", borderTop: `1px solid ${t.border}`,
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = `${t.blue}40`; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      />

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

        {/* Repo filter */}
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          margin: "0 10px 6px", padding: "3px 8px",
          background: t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
          border: `1px solid ${t.borderSubtle}`, borderRadius: 6, flexShrink: 0,
        }}>
          <span style={{ color: t.label4, fontSize: 10, lineHeight: 1 }}>⌕</span>
          <input
            value={repoSearch}
            onChange={(e) => setRepoSearch(e.target.value)}
            placeholder="Filter repos…"
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: t.label1, fontSize: 11,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
            }}
          />
          {repoSearch && (
            <button
              onClick={() => setRepoSearch("")}
              style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 12, padding: 0, lineHeight: 1 }}
            >×</button>
          )}
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
                    GitHub URL to clone, or repo name if already in <span style={{ color: t.teal, fontFamily: "monospace" }}>~/Documents/GitHub/</span>
                  </div>
                  <input
                    ref={addRepoUrlRef}
                    value={addRepoUrl}
                    onChange={(e) => { setAddRepoUrl(e.target.value); setAddRepoError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") startClone(); }}
                    placeholder="https://github.com/org/repo or my-repo"
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

        {/* PR filter pills */}
        <div style={{ display: "flex", gap: 4, padding: "0 10px 6px", flexShrink: 0 }}>
          {(["all", "mine", "review", "approved"] as const).map((f) => {
            const label = f === "all" ? "All" : f === "mine" ? "Mine" : f === "review" ? "Needs review" : "Approved";
            const isActive = prFilter === f;
            return (
              <button
                key={f}
                onClick={(e) => { e.stopPropagation(); setPrFilter(f); }}
                style={{
                  background: isActive ? `${t.blue}22` : "none",
                  border: `1px solid ${isActive ? t.blue + "60" : t.borderSubtle}`,
                  color: isActive ? t.blue : t.label4,
                  borderRadius: 10, cursor: "pointer", fontSize: 9, padding: "2px 7px",
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
                  fontWeight: isActive ? 700 : 400, transition: "all 0.1s",
                }}
              >{label}</button>
            );
          })}
        </div>

        {/* PR list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && (
            <div style={{ padding: "12px 16px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>Loading…</div>
          )}

          {!loading && Object.keys(byRepo).length === 0 && (
            <div style={{ padding: "12px 16px", color: t.label4, fontSize: 11 }}>
              {prFilter === "all" ? "No open PRs" : `No ${prFilter === "mine" ? "your" : prFilter === "review" ? "needs-review" : "approved"} PRs`}
            </div>
          )}

          {!loading && Object.entries(byRepo)
            .filter(([repoFullName]) => !repoSearch || (repoFullName.split("/").pop() ?? repoFullName).toLowerCase().includes(repoSearch.toLowerCase()))
            .sort((a, b) => {
              const aName = a[0].split("/").pop() ?? a[0];
              const bName = b[0].split("/").pop() ?? b[0];
              const aPinned = pinnedRepos.has(aName);
              const bPinned = pinnedRepos.has(bName);
              if (aPinned !== bPinned) return aPinned ? -1 : 1;
              return b[1].length - a[1].length;
            })
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

              const isPinned = pinnedRepos.has(repoName);
              const isRepoHovered = hoveredRepoKey === repoFullName;

              return (
                <div key={repoFullName}>
                  {/* Repo header */}
                  <div
                    onClick={(e) => { e.stopPropagation(); setRepoExpanded((p) => ({ ...p, [repoFullName]: !p[repoFullName] })); }}
                    onMouseEnter={() => setHoveredRepoKey(repoFullName)}
                    onMouseLeave={() => setHoveredRepoKey(null)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer", background: isRepoHovered ? hoverBg : "transparent" }}
                  >
                    <span style={{ color: t.label4, fontSize: 9, width: 8, flexShrink: 0 }}>{isExpanded ? "▼" : "▶"}</span>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill={isPinned ? t.orange : t.label3} style={{ flexShrink: 0 }}>
                      <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z" />
                    </svg>
                    <span style={{
                      flex: 1, color: isPinned ? t.label1 : t.label1, fontSize: 12, fontWeight: isPinned ? 600 : 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{repoName}</span>
                    {isRepoHovered && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onBrowseFiles(repoName); }}
                        data-tooltip="Browse files"
                        style={{
                          background: "none", border: "none", cursor: "pointer", padding: "0 2px",
                          color: t.label4, fontSize: 11, lineHeight: 1, flexShrink: 0,
                          transition: "color 0.12s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = t.teal)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                      ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg></button>
                    )}
                    {(isRepoHovered || isPinned) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePin(repoName); }}
                        title={isPinned ? "Unpin repo" : "Pin repo"}
                        style={{
                          background: "none", border: "none", cursor: "pointer", padding: "0 2px",
                          color: isPinned ? t.orange : t.label4, fontSize: 12, lineHeight: 1, flexShrink: 0,
                          transition: "color 0.12s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = t.orange)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = isPinned ? t.orange : t.label4)}
                      >⊙</button>
                    )}
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
                        {(repoChangeCounts[repoName] ?? 0) > 0 && (
                          <span style={{
                            background: `${t.red}20`, color: t.red,
                            border: `1px solid ${t.red}30`,
                            borderRadius: 10, fontSize: 8, padding: "0 5px",
                            fontFamily: "monospace", flexShrink: 0, lineHeight: 1.6,
                          }}>{repoChangeCounts[repoName]} changes</span>
                        )}
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
                  {isExpanded && [...repoPRs].sort((a, b) => {
                    const aActive = tabs.some(tab => tab.gitBranch === a.headRefName && tab.cwd?.includes(`/${repoName}`));
                    const bActive = tabs.some(tab => tab.gitBranch === b.headRefName && tab.cwd?.includes(`/${repoName}`));
                    return (bActive ? 1 : 0) - (aActive ? 1 : 0);
                  }).map((pr) => {
                    const hKey = `${repoFullName}:${pr.number}`;
                    const isSelected = selected?.prNumber === pr.number && selected?.repoName === repoName;
                    const isHovered = hoveredPRKey === hKey;
                    const { label: statusLabel, color: statusColor } = prStatus(pr, t);
                    const prCIChecks = ciChecks[pr.number];
                    const ciState = prCIChecks ? aggregateCIChecks(prCIChecks) : null;
                    const CI_ICON: Record<string, string> = { success: "✓", failure: "✗", pending: "⟳", unknown: "○" };
                    const CI_COLOR: Record<string, string> = { success: t.green, failure: t.red, pending: t.orange, unknown: t.label4 };

                    const inlineActions = [
                      { label: "Review",   icon: "◎", cmd: `claude "/review"`,       primary: true  },
                      { label: "Comments", icon: "≡", cmd: `claude "/pr-comments"`,  primary: false },
                      { label: "Fix",      icon: "✎", cmd: `claude "/pr-fixer"`,     primary: false },
                    ] as const;

                    // #2: detect if a terminal for this branch is already open
                    const existingBranchTab = tabs.find((tab) => tab.gitBranch === pr.headRefName && tab.cwd?.includes(`/${repoName}`));

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
                            {(prFilter === "all" || prFilter === "mine") && (
                              <span style={{
                                fontSize: 9, color: statusColor,
                                background: `${statusColor}18`,
                                border: `1px solid ${statusColor}30`,
                                borderRadius: 3, padding: "0px 4px",
                                fontWeight: 600, flexShrink: 0, lineHeight: 1.6,
                              }}>{statusLabel}</span>
                            )}
                            <div style={{ flex: 1 }} />
                            {isHovered && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(pr.headRefName);
                                    setCopiedBranchKey(hKey);
                                    setTimeout(() => setCopiedBranchKey(prev => prev === hKey ? null : prev), 1500);
                                  }}
                                  title={`Copy branch name: ${pr.headRefName}`}
                                  style={{
                                    background: copiedBranchKey === hKey ? `${t.green}18` : t.surface2,
                                    border: `1px solid ${copiedBranchKey === hKey ? `${t.green}40` : t.border}`,
                                    borderRadius: 3, color: copiedBranchKey === hKey ? t.green : t.label2,
                                    cursor: "pointer", fontSize: 9, padding: "1px 4px", lineHeight: 1,
                                    transition: "all 0.15s",
                                  }}
                                >{copiedBranchKey === hKey ? "✓" : "⎘"}</button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onOpenTerminal(repoName, pr.headRefName); }}
                                  title="Open terminal on this branch"
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
                            {ciState && (
                              <span
                                title={`CI ${ciState === "success" ? "passing" : ciState === "failure" ? "failing" : ciState === "pending" ? "pending" : "unknown"} · ${prCIChecks?.length ?? 0} check${(prCIChecks?.length ?? 0) !== 1 ? "s" : ""}`}
                                style={{ color: CI_COLOR[ciState], fontSize: 9, flexShrink: 0, fontFamily: "monospace" }}
                              >{CI_ICON[ciState]}</span>
                            )}
                            <span style={{ color: t.label4, fontSize: 9, flexShrink: 0 }}>{timeAgo(pr.createdAt)}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            {!!existingBranchTab && (
                              <span style={{ color: t.teal, fontSize: 7, flexShrink: 0, lineHeight: 1 }} title="Branch checked out in terminal">●</span>
                            )}
                            <div
                              title={pr.title}
                              style={{
                                flex: 1, minWidth: 0,
                                color: isSelected ? t.label1 : t.label2,
                                fontSize: 11, lineHeight: 1.4,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}
                            >
                              {pr.title}
                            </div>
                          </div>

                          {/* Inline Claude action buttons — reveal on hover */}
                          {isHovered && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{ marginTop: 5 }}
                            >
                              {existingBranchTab ? (
                                /* #2: branch tab already open — disable actions, offer focus */
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontSize: 9, color: t.label4, fontStyle: "italic" }}>
                                    Already open in a tab
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onFocusTab(existingBranchTab.id); }}
                                    style={{
                                      display: "flex", alignItems: "center", gap: 3,
                                      background: `${t.teal}15`, border: `1px solid ${t.teal}30`,
                                      borderRadius: 5, color: t.teal,
                                      cursor: "pointer", fontSize: 10, fontWeight: 600, padding: "2px 7px",
                                    }}
                                  >↗ Focus tab</button>
                                </div>
                              ) : (
                                /* #1: show actions + "→ new tab" destination hint */
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  {inlineActions.map(({ label, icon, cmd, primary }) => {
                                    const cKey = `${hKey}:${label}`;
                                    const busy = claudeCooldown.has(cKey);
                                    return (
                                      <button
                                        key={label}
                                        onClick={(e) => { e.stopPropagation(); handleClaudeAction(repoName, pr.headRefName, cmd, cKey); }}
                                        disabled={busy}
                                        style={{
                                          display: "flex", alignItems: "center", gap: 3,
                                          background: primary ? `${t.green}18` : (t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"),
                                          border: `1px solid ${primary ? t.green + "40" : t.border}`,
                                          borderRadius: 5, color: primary ? t.green : t.label2,
                                          cursor: busy ? "not-allowed" : "pointer",
                                          fontSize: 10, fontWeight: primary ? 600 : 500,
                                          padding: "2px 7px", opacity: busy ? 0.5 : 1,
                                        }}
                                      >
                                        <span style={{ fontSize: 9 }}>{busy ? "⟳" : icon}</span>
                                        {label}
                                      </button>
                                    );
                                  })}
                                  <span style={{ fontSize: 9, color: t.label4, marginLeft: 2 }}>→ new tab</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          {/* Repos without open PRs */}
          {(() => {
            const noPRRepos = allLocalRepos
              .filter(name => !Object.keys(byRepo).some(k => k.endsWith(`/${name}`) || k === name))
              .filter(name => !repoSearch || name.toLowerCase().includes(repoSearch.toLowerCase()))
              .sort((a, b) => {
                const aPinned = pinnedRepos.has(a);
                const bPinned = pinnedRepos.has(b);
                if (aPinned !== bPinned) return aPinned ? -1 : 1;
                return a.localeCompare(b);
              });
            const visibleNoPR = showNoPRRepos ? noPRRepos : noPRRepos.filter(n => pinnedRepos.has(n));
            return visibleNoPR.map(name => {
              const isPinned = pinnedRepos.has(name);
              const rowKey = `nopr:${name}`;
              const isRowHovered = hoveredRepoKey === rowKey;
              const isPickerOpen = branchPickerRepo === rowKey;
              const curBranch = repoCurBranch[name];
              const repoBranches = localBranches.filter((b) => b.repo === name && b.branch !== curBranch);
              const filteredBranches = branchSearch && isPickerOpen
                ? repoBranches.filter((b) => b.branch.toLowerCase().includes(branchSearch.toLowerCase()))
                : repoBranches;
              const allPickerItems = filteredBranches.map((b) => b.branch);
              return (
                <div key={name} onClick={(e) => e.stopPropagation()}>
                  <div
                    onClick={(e) => { e.stopPropagation(); onSelectRepoTree(name); }}
                    onMouseEnter={() => setHoveredRepoKey(rowKey)}
                    onMouseLeave={() => setHoveredRepoKey(null)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer", background: isRowHovered ? hoverBg : "transparent" }}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill={isPinned ? t.orange : t.label4} style={{ flexShrink: 0 }}>
                      <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z" />
                    </svg>
                    <span style={{ flex: 1, color: isPinned ? t.label2 : t.label3, fontSize: 12, fontWeight: isPinned ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                    {isRowHovered && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onBrowseFiles(name); }}
                        data-tooltip="Browse files"
                        style={{
                          background: "none", border: "none", cursor: "pointer", padding: "0 2px",
                          color: t.label4, fontSize: 11, lineHeight: 1, flexShrink: 0,
                          transition: "color 0.12s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = t.teal)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                      ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg></button>
                    )}
                    {(isRowHovered || isPinned) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePin(name); }}
                        data-tooltip={isPinned ? "Unpin repo" : "Pin repo"}
                        style={{
                          background: "none", border: "none", cursor: "pointer", padding: "0 2px",
                          color: isPinned ? t.orange : t.label4, fontSize: 12, lineHeight: 1, flexShrink: 0,
                          transition: "color 0.12s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = t.orange)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = isPinned ? t.orange : t.label4)}
                      >⊙</button>
                    )}
                    {!isPinned && !isRowHovered && <span style={{ fontSize: 9, color: t.label4, fontFamily: "monospace" }}>no PRs</span>}
                  </div>

                  {/* Branch picker trigger — pinned repos only */}
                  {isPinned && (
                    <div style={{ padding: "2px 12px 4px 26px" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          if (isPickerOpen) { setBranchPickerRepo(null); return; }
                          setBranchPickerRepo(rowKey);
                          setBranchSearch("");
                          setBranchCursor(0);
                          window.terminal.getRepoBranch(name).then((b) => {
                            if (b) setRepoCurBranch((prev) => ({ ...prev, [name]: b }));
                          }).catch(() => {});
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
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {curBranch ?? "select branch"}
                        </span>
                        <span style={{ fontSize: 8, color: t.label4, flexShrink: 0 }}>{isPickerOpen ? "∧" : "∨"}</span>
                      </button>
                    </div>
                  )}

                  {/* Branch picker dropdown */}
                  {isPinned && isPickerOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ margin: "2px 8px 6px", background: t.surface2, border: `1px solid ${t.border}`, borderRadius: 7, overflow: "hidden" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderBottom: `1px solid ${t.border}` }}>
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
                              if (b) { onCheckoutBranch(name, b); setBranchPickerRepo(null); }
                            } else if (e.key === "Escape") { setBranchPickerRepo(null); }
                          }}
                          placeholder="Search branches"
                          style={{ flex: 1, background: "none", border: "none", outline: "none", color: t.label1, fontSize: 11, fontFamily: "monospace" }}
                        />
                      </div>
                      {curBranch && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px" }}>
                          <span style={{ color: t.green, fontSize: 10, width: 10, flexShrink: 0 }}>✓</span>
                          <span style={{ color: t.label4, fontSize: 9, flexShrink: 0 }}>ᵍ°</span>
                          <span style={{ color: t.green, fontSize: 11, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{curBranch}</span>
                        </div>
                      )}
                      <div style={{ maxHeight: 180, overflowY: "auto" }}>
                        {allPickerItems.map((b, i) => {
                          const isActive = branchCursor === i;
                          return (
                            <div
                              key={b}
                              onMouseEnter={() => setBranchCursor(i)}
                              onClick={() => { onCheckoutBranch(name, b); setBranchPickerRepo(null); }}
                              style={{
                                display: "flex", alignItems: "center", gap: 6,
                                padding: "4px 10px", cursor: "pointer",
                                background: isActive ? `${t.blue}22` : "transparent",
                              }}
                            >
                              <span style={{ color: t.label4, fontSize: 9, flexShrink: 0 }}>ᵍ°</span>
                              <span style={{ color: t.label2, fontSize: 11, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b}</span>
                            </div>
                          );
                        })}
                        {allPickerItems.length === 0 && (
                          <div style={{ padding: "8px 10px", color: t.label4, fontSize: 11 }}>No branches found</div>
                        )}
                      </div>
                      <div style={{ borderTop: `1px solid ${t.border}`, padding: "3px 10px", display: "flex", gap: 14, color: t.label4, fontSize: 9 }}>
                        <span><span style={{ color: t.label2 }}>↑↓</span> navigate</span>
                        <span><span style={{ color: t.label2 }}>↵</span> checkout</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            });
          })()}

          {/* Disclosure toggle for repos with no PRs */}
          {(() => {
            const noPRRepos = allLocalRepos
              .filter(name => !Object.keys(byRepo).some(k => k.endsWith(`/${name}`) || k === name))
              .filter(name => !repoSearch || name.toLowerCase().includes(repoSearch.toLowerCase()));
            const unpinnedNoPR = noPRRepos.filter(n => !pinnedRepos.has(n));
            if (unpinnedNoPR.length === 0) return null;
            return (
              <div
                onClick={() => setShowNoPRRepos(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "5px 12px 4px", cursor: "pointer",
                  borderTop: `1px solid ${t.border}`,
                  color: t.label4,
                }}
                onMouseEnter={(e) => { (e.currentTarget.querySelector(".noPRLabel") as HTMLElement | null)?.style.setProperty("color", t.label3); }}
                onMouseLeave={(e) => { (e.currentTarget.querySelector(".noPRLabel") as HTMLElement | null)?.style.setProperty("color", t.label4); }}
              >
                <span className="noPRLabel" style={{ color: t.label4, fontSize: 9, letterSpacing: "0.06em", fontWeight: 700, flex: 1 }}>NO OPEN PRS</span>
                <span style={{ fontSize: 9, color: t.label4, fontFamily: "monospace" }}>{unpinnedNoPR.length}</span>
                <span style={{ fontSize: 9, color: t.label4, marginLeft: 4 }}>{showNoPRRepos ? "▾" : "▸"}</span>
              </div>
            );
          })()}

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
