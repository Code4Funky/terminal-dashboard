import { useState, useEffect, useRef } from "react";
import { useTheme } from "../ThemeContext";
import { SYS_FONT, MONO_FONT, TABULAR } from "../theme";
import {
  panelHeader, panelTitle, sectionLabel, rowState, chip, dot,
  CLIP, CLIP_LEFT, RADIUS, RADIUS_SM, TRANSITION,
} from "../chrome";
import type { DotState } from "../chrome";
import type { TaskSummary } from "../types/tasks";

// ── Terminal tabs ─────────────────────────────────────────────────────────────

export interface TerminalTab {
  id: string;
  number: number;
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
  updatedAt: string;
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
  /** Aggregates for the global status bar — reported up so PRs aren't polled twice. */
  onSummary?: (s: { repos: number; prs: number; syncedAt: number | null }) => void;
}

/** Compact elapsed time for the session rows — "now", "4m", "2h", "3d". */
function shortAgo(epochMs: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
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
  // Only consider CheckRun items — StatusContext items represent branch protection
  // rules (e.g. "Review required") already surfaced via the reviewDecision badge.
  const ciChecks = checks.filter(c => c.__typename === "CheckRun");
  if (ciChecks.length === 0) return "unknown";
  if (ciChecks.some(c => c.conclusion === "FAILURE" || c.conclusion === "TIMED_OUT" || c.conclusion === "ACTION_REQUIRED")) return "failure";
  if (ciChecks.some(c => c.status === "IN_PROGRESS" || c.status === "QUEUED" || c.status === "WAITING" || c.status === "PENDING")) return "pending";
  if (ciChecks.every(c => c.conclusion === "SUCCESS" || c.conclusion === "NEUTRAL" || c.conclusion === "SKIPPED")) return "success";
  return "unknown";
}

const CI_ICON: Record<string, string> = { success: "●", failure: "●", pending: "↻", unknown: "○" };

/** Sessions panel width — Dashboard reserves the same figure when sizing the right-hand drawers. */
export const SIDEBAR_W = 264;

const FILTER_LABEL: Record<string, string> = { all: "All", mine: "Mine", review: "Needs review", changes: "Changes", approved: "Approved" };
const FILTER_EMPTY: Record<string, string> = { all: "No open PRs", mine: "No your PRs", review: "No needs-review PRs", changes: "No changes-requested PRs", approved: "No approved PRs" };

export function RepoSidebar({
  tabs, focusedId, onFocusTab, onCloseTab, onAddTab,
  selected, onSelectPR, onOpenTerminal, onOpenRepoTerminal, onSelectRepoTree, onReposLoaded, onCheckoutBranch, onBrowseFiles, onSummary,
}: Props) {
  const { theme: t } = useTheme();
  const CI_COLOR: Record<string, string> = { success: t.green, failure: t.red, pending: t.orange, unknown: t.label4 };

  // Terminal tab hover
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);

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

  // Resizable split between SESSIONS and REPOSITORIES
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
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [prFilter, setPrFilter] = useState<"all" | "mine" | "review" | "changes" | "approved">("all");
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [repoExpanded, setRepoExpanded] = useState<Record<string, boolean>>({});
  const [hoveredPRKey, setHoveredPRKey] = useState<string | null>(null);
  const [copiedBranchKey, setCopiedBranchKey] = useState<string | null>(null);
  const [hoveredRepoKey, setHoveredRepoKey] = useState<string | null>(null);

  // Pinned repos — persisted to localStorage
  const [pinnedRepos, setPinnedRepos] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("tdash:pinned-repos");
      return new Set(saved ? JSON.parse(saved) : []);
    } catch { return new Set(); }
  });

  const togglePin = (repoName: string) => {
    const wasTracked = pinnedRepos.has(repoName);
    if (wasTracked && !window.confirm(`Stop tracking "${repoName}"?`)) return;
    setPinnedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repoName)) next.delete(repoName); else next.add(repoName);
      localStorage.setItem("tdash:pinned-repos", JSON.stringify([...next]));
      return next;
    });
    if (wasTracked) {
      setPRs((p) => p.filter((pr) => pr.repository.name !== repoName));
    }
  };

  // CI status per PR number
  const [ciChecks, setCIChecks] = useState<Record<number, CICheck[]>>({});

  // All local repos (including those without open PRs)
  const [allLocalRepos, setAllLocalRepos] = useState<string[]>([]);
  // Maps local folder name → GitHub nameWithOwner (e.g. "ansible-skedulo-kube" → "skedulo/ansible-config")
  const [localRepoGhName, setLocalRepoGhName] = useState<Record<string, string>>({});

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
      setSyncedAt(Date.now());
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
        // Build folder→ghNameWithOwner map so we can deduplicate repos with mismatched folder/GitHub names
        const ghNameMap: Record<string, string> = {};
        localRepos.forEach(r => {
          if (!r.repoUrl) return;
          const m = r.repoUrl.replace(/\.git$/, "").match(/github\.com[:/](.+\/[^/]+)$/);
          if (m) ghNameMap[r.name] = m[1];
        });
        setLocalRepoGhName(ghNameMap);
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

  useEffect(() => {
    if (allLocalRepos.length === 0) return;
    Promise.all(
      allLocalRepos.map(name =>
        window.terminal.getRepoBranch(name)
          .then(b => b ? ([name, b] as const) : null)
          .catch(() => null)
      )
    ).then(results => {
      const updates: Record<string, string> = {};
      results.forEach(r => { if (r) updates[r[0]] = r[1]; });
      if (Object.keys(updates).length > 0) setRepoCurBranch(prev => ({ ...prev, ...updates }));
    });
  }, [allLocalRepos.join(",")]);

  useEffect(() => {
    onSummary?.({ repos: allLocalRepos.length, prs: prs.length, syncedAt });
  }, [allLocalRepos.length, prs.length, syncedAt, onSummary]);

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
    const ghRepoName = branchPickerRepo.split("/").pop() ?? branchPickerRepo;
    // Resolve local folder name (may differ from GitHub name, e.g. ansible-skedulo-kube vs ansible-config)
    const localFolder = Object.entries(localRepoGhName).find(
      ([, ghName]) => ghName === branchPickerRepo || ghName.split("/").pop() === ghRepoName
    )?.[0] ?? ghRepoName;
    const focused = tabs.find((t) => t.id === focusedId);
    if (focused?.gitBranch && (focused?.cwd?.includes(`/${localFolder}`) || focused?.cwd?.includes(`/${ghRepoName}`))) {
      setRepoCurBranch((prev) => ({ ...prev, [localFolder]: focused.gitBranch! }));
      return;
    }
    window.terminal.getRepoBranch(localFolder).then((b) => {
      if (b) setRepoCurBranch((prev) => ({ ...prev, [localFolder]: b }));
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
    if (prFilter === "changes") return pr.reviewDecision === "CHANGES_REQUESTED";
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
    const prUrl = pr.url || `https://github.com/${pr.repository.nameWithOwner}/pull/${pr.number}`;
    onSelectPR(isSame ? null : { prNumber: pr.number, repoName, prTitle: pr.title, branch: pr.headRefName, prUrl });
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
        width: SIDEBAR_W, flexShrink: 0,
        background: t.surface1,
        borderRight: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}
      onClick={() => setBranchPickerRepo(null)}
    >

      {/* ── SESSIONS section ── */}
      <div style={{ height: terminalHeight, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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

        {/* Session rows, grouped by agents vs plain shells */}
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 6 }}>
          {(() => {
            const repoOf = (tab: TerminalTab) =>
              tab.cwd?.includes("/GitHub/") ? (tab.cwd.split("/GitHub/")[1]?.split("/")[0] ?? "") : "";

            // Repo order within a group keeps sessions on the same codebase adjacent
            const byRepo = (a: TerminalTab, b: TerminalTab) => repoOf(a).localeCompare(repoOf(b));
            const agents = tabs.filter((tb) => claudePanelNums.has(tb.number)).sort(byRepo);
            const shells = tabs.filter((tb) => !claudePanelNums.has(tb.number)).sort(byRepo);

            const renderRow = (tab: TerminalTab) => {
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

              // Matching PR: main list first, then the per-tab cache (covers other-author PRs)
              const cacheKey = gitRepoName && tab.gitBranch ? `${gitRepoName}:${tab.gitBranch}` : null;
              const tabPR = tab.gitBranch
                ? (prs.find((pr) =>
                    pr.headRefName === tab.gitBranch &&
                    (!tab.cwd || tab.cwd.includes(pr.repository.name))
                  ) ?? (cacheKey ? tabPRCache[cacheKey] : null) ?? null)
                : null;

              const wtStats = gitRepoName ? repoTabStats[gitRepoName] : null;
              const prStats = tabPR != null ? { adds: tabPR.additions ?? 0, dels: tabPR.deletions ?? 0 } : null;
              const tabStats = (wtStats && (wtStats.adds > 0 || wtStats.dels > 0)) ? wtStats : prStats;

              // Activity comes from the agent's task list — the only signal that actually means "working"
              const state: DotState = summary && summary.inProgress > 0 ? "running" : "idle";
              const statusText = summary
                ? (summary.inProgress > 0 ? shortAgo(summary.updatedAt)
                  : summary.completed === summary.total ? "done"
                  : `${summary.completed}/${summary.total}`)
                : null;

              const secondLine = tab.gitBranch
                ? { icon: "⎇", text: tab.gitBranch, clip: CLIP_LEFT }
                : tab.cwd
                  ? { icon: "", text: tab.cwd.replace(/^\/Users\/[^/]+/, "~"), clip: CLIP_LEFT }
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
                        color: state === "running" ? t.green : t.label3,
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
                          ...MONO_FONT, ...secondLine.clip,
                        }}
                      >{secondLine.text}</span>
                      <span style={{ flex: 1, minWidth: 0 }} />
                      {tabStats && (tabStats.adds > 0 || tabStats.dels > 0) && (
                        <span style={{ flex: "none", display: "flex", gap: 4, fontSize: 10, ...MONO_FONT, ...TABULAR }}>
                          {tabStats.adds > 0 && <span style={{ color: t.green }}>+{tabStats.adds}</span>}
                          {tabStats.dels > 0 && <span style={{ color: t.red }}>-{tabStats.dels}</span>}
                        </span>
                      )}
                      {tabPR && (
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
                {agents.map(renderRow)}
                {shells.length > 0 && (
                  <div style={sectionLabel(t)}>Shells · {shells.length}</div>
                )}
                {shells.map(renderRow)}
              </>
            );
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
        <div style={panelHeader(t)}>
          <span style={{ ...panelTitle(t), flex: 1 }}>Repositories</span>
          <span style={{ ...chip(t), flex: "none" }}>{allLocalRepos.length} · {prs.length} PR</span>
          <button
            onClick={(e) => { e.stopPropagation(); load(); }}
            title="Refresh"
            aria-label="Refresh repositories"
            style={{
              width: 20, height: 20, flex: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "none", border: "none", borderRadius: RADIUS_SM, cursor: "pointer",
              color: t.label3, fontSize: 13, lineHeight: 1, transition: TRANSITION,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.label1; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.label3; }}
          >↺</button>
          <button
            onClick={(e) => { e.stopPropagation(); setShowAddRepo(true); setTimeout(() => addRepoUrlRef.current?.focus(), 50); }}
            title="Add repository"
            aria-label="Add repository"
            style={{
              width: 20, height: 20, flex: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "none", border: "none", borderRadius: RADIUS_SM, cursor: "pointer",
              color: t.label3, fontSize: 15, lineHeight: 1, transition: TRANSITION,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.label1; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.label3; }}
          >+</button>
        </div>

        {/* Repo filter */}
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          margin: "8px 10px 6px", padding: "3px 8px",
          background: t.surface0,
          border: `1px solid ${t.borderMid}`, borderRadius: RADIUS, flexShrink: 0,
        }}>
          <span style={{ color: t.label4, fontSize: 10, lineHeight: 1 }}>⌕</span>
          <input
            value={repoSearch}
            onChange={(e) => setRepoSearch(e.target.value)}
            placeholder="Filter repos…"
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: t.label1, fontSize: 11.5, ...SYS_FONT,
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
              border: `1px solid ${t.border}`, borderRadius: RADIUS,
              padding: "20px 22px", boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
            }}>
              {/* Title */}
              <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
                <span style={{ flex: 1, color: t.label1, fontWeight: 600, fontSize: 14 }}>Add repository</span>
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
                    GitHub URL to clone, or repo name if already in <span style={{ color: t.teal, ...MONO_FONT }}>~/Documents/GitHub/</span>
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
                      borderRadius: RADIUS, color: t.label1, fontSize: 12, ...MONO_FONT,
                      padding: "8px 10px", outline: "none", marginBottom: addRepoError ? 6 : 14,
                    }}
                  />
                  {addRepoError && (
                    <div style={{ color: t.red, fontSize: 11, marginBottom: 12, ...MONO_FONT, wordBreak: "break-word" }}>
                      {addRepoError}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      onClick={closeAddRepo}
                      style={{
                        background: t.surface2, border: `1px solid ${t.border}`,
                        borderRadius: RADIUS, color: t.label2, cursor: "pointer",
                        fontSize: 12, fontWeight: 600, padding: "6px 16px",
                      }}
                    >Cancel</button>
                    <button
                      onClick={startClone}
                      disabled={!addRepoUrl.trim()}
                      style={{
                        background: addRepoUrl.trim() ? t.green : t.surface2,
                        border: "none", borderRadius: RADIUS,
                        color: addRepoUrl.trim() ? "#fff" : t.label4,
                        cursor: addRepoUrl.trim() ? "pointer" : "default",
                        fontSize: 12, fontWeight: 600, padding: "6px 18px",
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
                    <span style={{ color: t.teal, ...MONO_FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{addRepoUrl}</span>
                  </div>
                  <pre
                    ref={progressRef}
                    style={{
                      background: t.surface2, border: `1px solid ${t.border}`,
                      borderRadius: RADIUS, padding: "8px 10px",
                      color: t.label2, fontSize: 10, ...MONO_FONT,
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
                      Cloned <span style={{ color: t.green, ...MONO_FONT }}>{addRepoDoneName}</span>
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={closeAddRepo}
                      style={{
                        background: t.green, border: "none", borderRadius: RADIUS,
                        color: "#fff", cursor: "pointer",
                        fontSize: 12, fontWeight: 600, padding: "6px 20px",
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
          {(["all", "mine", "review", "changes", "approved"] as const).map((f) => {
            const label = FILTER_LABEL[f];
            const isActive = prFilter === f;
            return (
              <button
                key={f}
                onClick={(e) => { e.stopPropagation(); setPrFilter(f); }}
                style={{
                  background: isActive ? `${t.blue}22` : "none",
                  border: `1px solid ${isActive ? t.blue + "60" : t.borderSubtle}`,
                  color: isActive ? t.blue : t.label4,
                  borderRadius: RADIUS, cursor: "pointer", fontSize: 9, padding: "2px 7px",
                  ...SYS_FONT,
                  fontWeight: isActive ? 700 : 400, transition: "all 0.1s",
                }}
              >{label}</button>
            );
          })}
        </div>

        {/* PR list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && (
            <div style={{ padding: "12px 16px", color: t.label4, fontSize: 11, ...MONO_FONT }}>Loading…</div>
          )}

          {!loading && pinnedRepos.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px 3px" }}>
              <span style={{ fontSize: 9, letterSpacing: "0.08em", fontWeight: 600, color: t.label4, flex: 1 }}>TRACKING</span>
              <span style={{ fontSize: 9, color: t.blue, ...MONO_FONT }}>{pinnedRepos.size}</span>
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

              const isPinned = pinnedRepos.has(repoName);
              // Find a local folder alias that is pinned but whose GitHub remote URL resolves to this repo
              const aliasedPinnedFolder = !isPinned
                ? (Object.entries(localRepoGhName).find(
                    ([folderName, ghName]) =>
                      pinnedRepos.has(folderName) &&
                      (ghName === repoFullName || ghName.toLowerCase() === repoFullName.toLowerCase())
                  )?.[0] ?? null)
                : null;
              const effectivePinned = isPinned || aliasedPinnedFolder !== null;
              // Local folder name may differ from GitHub repo name (e.g. ansible-skedulo-kube vs ansible-config)
              const localFolderName = aliasedPinnedFolder ?? repoName;

              const curBranch = repoCurBranch[localFolderName];
              const isPickerOpen = branchPickerRepo === repoFullName;
              const prBranchSet = new Set(repoPRs.map((p) => p.headRefName));
              const repoBranches = localBranches.filter((b) => b.repo === localFolderName && b.branch !== curBranch);
              const filteredBranches = branchSearch
                ? repoBranches.filter((b) => b.branch.toLowerCase().includes(branchSearch.toLowerCase()))
                : repoBranches;
              const recentBranches = filteredBranches.filter((b) => prBranchSet.has(b.branch));
              const otherBranches = filteredBranches.filter((b) => !prBranchSet.has(b.branch));
              const allPickerItems = [
                ...recentBranches.map((b) => b.branch),
                ...otherBranches.map((b) => b.branch),
              ];
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
                    <svg width="12" height="12" viewBox="0 0 16 16" fill={effectivePinned ? t.orange : t.label3} style={{ flexShrink: 0 }} title={effectivePinned ? "Tracked repo" : "Repo"}>
                      <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z" />
                    </svg>
                    <span style={{
                      flex: 1, color: t.label1, fontSize: 12, fontWeight: effectivePinned ? 600 : 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{repoName}</span>
                    {isRepoHovered && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); onOpenRepoTerminal(localFolderName); }}
                          title="Open terminal"
                          style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: t.label4, lineHeight: 1, flexShrink: 0 }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = t.green)}
                          onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                        ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9l3 3-3 3"/><path d="M13 15h3"/></svg></button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onBrowseFiles(repoName); }}
                          title="Browse files"
                          style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: t.label4, lineHeight: 1, flexShrink: 0 }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = t.teal)}
                          onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                        ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg></button>
                        {effectivePinned && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const displayName = isPinned ? repoName : (aliasedPinnedFolder ?? repoName);
                              if (!window.confirm(`Stop tracking "${displayName}"?`)) return;
                              setPinnedRepos((prev) => {
                                const next = new Set(prev);
                                if (isPinned) next.delete(repoName);
                                if (aliasedPinnedFolder) next.delete(aliasedPinnedFolder);
                                localStorage.setItem("tdash:pinned-repos", JSON.stringify([...next]));
                                return next;
                              });
                              setPRs((p) => p.filter((pr) => pr.repository.name !== repoName));
                            }}
                            title="Stop tracking"
                            style={{
                              background: `${t.red}12`, border: `1px solid ${t.red}30`,
                              borderRadius: RADIUS, color: t.red, cursor: "pointer",
                              fontSize: 9, padding: "1px 6px", lineHeight: 1.6, flexShrink: 0,
                            }}
                          >Stop</button>
                        )}
                      </>
                    )}
                    <span style={{
                      fontSize: 10, color: t.label3, background: t.surface2,
                      borderRadius: RADIUS, padding: "1px 5px", ...MONO_FONT, flexShrink: 0,
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
                          background: isPickerOpen ? `${t.green}18` : (t.isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)"),
                          border: `1px solid ${isPickerOpen ? t.green + "50" : t.border}`,
                          borderRadius: RADIUS, color: isPickerOpen ? t.green : t.teal,
                          cursor: "pointer", fontSize: 10, ...MONO_FONT,
                          padding: "3px 7px", textAlign: "left",
                        }}
                      >
                        <span style={{ fontSize: 9, flexShrink: 0 }}>ᵍ°</span>
                        <span style={{
                          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{curBranch ?? "current branch"}</span>
                        {(repoChangeCounts[repoName] ?? 0) > 0 && (
                          <span style={{
                            background: `${t.red}20`, color: t.red,
                            border: `1px solid ${t.red}30`,
                            borderRadius: RADIUS, fontSize: 8, padding: "0 5px",
                            ...MONO_FONT, flexShrink: 0, lineHeight: 1.6,
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
                        borderRadius: RADIUS, overflow: "hidden",
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
                              if (b) { onCheckoutBranch(localFolderName, b); setBranchPickerRepo(null); }
                            } else if (e.key === "Escape") { setBranchPickerRepo(null); }
                          }}
                          placeholder="Search branches"
                          style={{
                            flex: 1, background: "none", border: "none", outline: "none",
                            color: t.label1, fontSize: 11, ...MONO_FONT,
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
                          <span style={{ color: t.green, fontSize: 11, ...MONO_FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{curBranch}</span>
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
                                  onClick={() => { onCheckoutBranch(localFolderName, b.branch); setBranchPickerRepo(null); }}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 6,
                                    padding: "4px 10px", cursor: "pointer",
                                    background: isActive ? `${t.blue}22` : "transparent",
                                  }}
                                >
                                  <span style={{ color: t.label4, fontSize: 9, flexShrink: 0 }}>ᵍ°</span>
                                  <span style={{
                                    color: t.label2, fontSize: 11, ...MONO_FONT,
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
                                  onClick={() => { onCheckoutBranch(localFolderName, b.branch); setBranchPickerRepo(null); }}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 6,
                                    padding: "4px 10px", cursor: "pointer",
                                    background: isActive ? `${t.blue}22` : "transparent",
                                  }}
                                >
                                  <span style={{ color: t.label4, fontSize: 9, flexShrink: 0 }}>ᵍ°</span>
                                  <span style={{
                                    color: t.label2, fontSize: 11, ...MONO_FONT,
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
                    const aActive = tabs.some(t => t.gitBranch === a.headRefName && t.cwd?.includes(`/${repoName}`));
                    const bActive = tabs.some(t => t.gitBranch === b.headRefName && t.cwd?.includes(`/${repoName}`));
                    if (aActive !== bActive) return aActive ? -1 : 1;
                    const aMine = ghLogin ? a.author?.login === ghLogin : false;
                    const bMine = ghLogin ? b.author?.login === ghLogin : false;
                    if (aMine !== bMine) return aMine ? -1 : 1;
                    if (a.isDraft !== b.isDraft) return a.isDraft ? 1 : -1;
                    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
                  }).map((pr) => {
                    const hKey = `${repoFullName}:${pr.number}`;
                    const isSelected = selected?.prNumber === pr.number && selected?.repoName === repoName;
                    const isHovered = hoveredPRKey === hKey;
                    const { label: statusLabel, color: statusColor } = prStatus(pr, t);
                    const prCIChecks = ciChecks[pr.number];
                    const ciState = prCIChecks ? aggregateCIChecks(prCIChecks) : null;
                    const ciCheckCount = prCIChecks?.filter(c => c.__typename === "CheckRun").length ?? 0;

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
                            <span style={{ color: t.label3, fontSize: 10, ...MONO_FONT, flexShrink: 0 }}>#{pr.number}</span>
                            {(prFilter === "all" || prFilter === "mine") && (
                              <span style={{
                                fontSize: 9, color: statusColor,
                                background: `${statusColor}18`,
                                border: `1px solid ${statusColor}30`,
                                borderRadius: 3, padding: "0px 4px",
                                fontWeight: 600, flexShrink: 0, lineHeight: 1.6,
                              }}>{statusLabel}</span>
                            )}
                            {/* right group — always visible */}
                            <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto", flexShrink: 0 }}>
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
                                      cursor: "pointer", padding: "2px 5px", lineHeight: 1,
                                      display: "flex", alignItems: "center", transition: "all 0.15s",
                                    }}
                                  >
                                    {copiedBranchKey === hKey
                                      ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                      : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                    }
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); const ghUrl = pr.url || `https://github.com/${pr.repository.nameWithOwner}/pull/${pr.number}`; window.terminal.openExternal(ghUrl); }}
                                    title={`Open PR in GitHub: ${pr.url}`}
                                    style={{
                                      background: `${t.blue}15`, border: `1px solid ${t.blue}30`,
                                      borderRadius: 3, color: t.blue,
                                      cursor: "pointer", padding: "2px 5px", lineHeight: 1,
                                      display: "flex", alignItems: "center",
                                    }}
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                  </button>
                                </>
                              )}
                              {ciState && (
                                <span
                                  title={`CI ${ciState === "success" ? "passing" : ciState === "failure" ? "failing" : ciState === "pending" ? "pending" : "unknown"} · ${ciCheckCount} check${ciCheckCount !== 1 ? "s" : ""}`}
                                  style={{
                                    width: 18, height: 18, borderRadius: "50%",
                                    background: t.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
                                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                                    flexShrink: 0,
                                  }}
                                >
                                  <span style={{ color: CI_COLOR[ciState], fontSize: ciState === "pending" ? 11 : 7, ...MONO_FONT, lineHeight: 1 }}>{CI_ICON[ciState]}</span>
                                </span>
                              )}
                              <span style={{ color: t.label4, fontSize: 9 }}>{timeAgo(pr.createdAt)}</span>
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            {!!existingBranchTab && (
                              <span
                                style={{ color: existingBranchTab.id === focusedId ? t.teal : t.orange, fontSize: 7, flexShrink: 0, lineHeight: 1 }}
                                title={existingBranchTab.id === focusedId ? "Active terminal on this branch" : "Terminal open on this branch"}
                              >●</span>
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

                          {isHovered && (
                            <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 5, display: "flex", justifyContent: "flex-end" }}>
                              {existingBranchTab ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onFocusTab(existingBranchTab.id); }}
                                  title="Focus existing tab"
                                  style={{
                                    background: `${t.teal}15`, border: `1px solid ${t.teal}30`,
                                    borderRadius: 3, color: t.teal, cursor: "pointer",
                                    padding: "2px 6px", display: "flex", alignItems: "center", gap: 3,
                                    fontSize: 9, fontWeight: 600,
                                  }}
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                  Focus
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onOpenTerminal(repoName, pr.headRefName); }}
                                  title="Open new terminal tab on this branch"
                                  style={{
                                    background: `${t.teal}15`, border: `1px solid ${t.teal}30`,
                                    borderRadius: 3, color: t.teal, cursor: "pointer",
                                    padding: "2px 5px", display: "flex", alignItems: "center",
                                  }}
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9l3 3-3 3"/><path d="M13 15h3"/></svg>
                                </button>
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
          {/* Repos without open PRs — TRACKING / NOT TRACKING */}
          {(() => {
            const noPRRepos = allLocalRepos
              .filter(name => {
                const byRepoKeys = Object.keys(byRepo);
                if (byRepoKeys.some(k => k.endsWith(`/${name}`) || k === name)) return false;
                // Also deduplicate by GitHub remote URL (handles mismatched folder/repo names)
                const ghName = localRepoGhName[name];
                if (ghName && byRepoKeys.some(k => k === ghName || k.toLowerCase() === ghName.toLowerCase())) return false;
                return true;
              })
              .filter(name => !repoSearch || name.toLowerCase().includes(repoSearch.toLowerCase()))
              .sort((a, b) => a.localeCompare(b));
            const trackedNoPR = noPRRepos.filter(n => pinnedRepos.has(n));
            const untrackedNoPR = noPRRepos.filter(n => !pinnedRepos.has(n));

            const renderRow = (name: string, isTracked: boolean) => {
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
                    style={{
                      display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
                      cursor: "pointer", background: isRowHovered ? hoverBg : "transparent",
                      borderLeft: isTracked ? `2px solid ${t.blue}` : "2px solid transparent",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill={isTracked ? t.orange : t.label4} style={{ flexShrink: 0 }} title={isTracked ? "Tracked repo" : "Repo"}>
                      <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z" />
                    </svg>
                    <span style={{ flex: 1, color: isTracked ? t.label2 : t.label3, fontSize: 12, fontWeight: isTracked ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                    {isRowHovered && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); onOpenRepoTerminal(name); }}
                          title="Open terminal"
                          style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: t.label4, lineHeight: 1, flexShrink: 0 }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = t.green)}
                          onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                        ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9l3 3-3 3"/><path d="M13 15h3"/></svg></button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onBrowseFiles(name); }}
                          title="Browse files"
                          style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: t.label4, lineHeight: 1, flexShrink: 0 }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = t.teal)}
                          onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                        ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg></button>
                      </>
                    )}
                    {isTracked ? (
                      isRowHovered ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); togglePin(name); }}
                          title="Stop tracking"
                          style={{
                            background: `${t.red}12`, border: `1px solid ${t.red}30`,
                            borderRadius: RADIUS, color: t.red, cursor: "pointer",
                            fontSize: 9, padding: "1px 6px", lineHeight: 1.6, flexShrink: 0,
                          }}
                        >Stop</button>
                      ) : (
                        <span title="Tracking" style={{ color: t.blue, fontSize: 7, flexShrink: 0 }}>●</span>
                      )
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePin(name); }}
                        title="Track this repo's PRs"
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          background: "none", border: `1px solid ${t.border}`,
                          borderRadius: RADIUS, color: t.label2, cursor: "pointer",
                          fontSize: 10, fontWeight: 600, padding: "2px 8px", lineHeight: 1.6, flexShrink: 0,
                        }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>
                        </svg>
                        Track
                      </button>
                    )}
                  </div>

                  {/* Branch picker trigger — tracked repos only */}
                  {isTracked && (
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
                          background: isPickerOpen ? `${t.green}18` : (t.isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)"),
                          border: `1px solid ${isPickerOpen ? t.green + "50" : t.border}`,
                          borderRadius: RADIUS, color: isPickerOpen ? t.green : t.teal,
                          cursor: "pointer", fontSize: 10, ...MONO_FONT,
                          padding: "3px 7px", textAlign: "left",
                        }}
                      >
                        <span style={{ fontSize: 9, flexShrink: 0 }}>ᵍ°</span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {curBranch ?? "current branch"}
                        </span>
                        <span style={{ fontSize: 8, color: t.label4, flexShrink: 0 }}>{isPickerOpen ? "∧" : "∨"}</span>
                      </button>
                    </div>
                  )}

                  {/* Branch picker dropdown */}
                  {isTracked && isPickerOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ margin: "2px 8px 6px", background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS, overflow: "hidden" }}
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
                          style={{ flex: 1, background: "none", border: "none", outline: "none", color: t.label1, fontSize: 11, ...MONO_FONT }}
                        />
                      </div>
                      {curBranch && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px" }}>
                          <span style={{ color: t.green, fontSize: 10, width: 10, flexShrink: 0 }}>✓</span>
                          <span style={{ color: t.label4, fontSize: 9, flexShrink: 0 }}>ᵍ°</span>
                          <span style={{ color: t.green, fontSize: 11, ...MONO_FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{curBranch}</span>
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
                              style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", cursor: "pointer", background: isActive ? `${t.blue}22` : "transparent" }}
                            >
                              <span style={{ color: t.label4, fontSize: 9, flexShrink: 0 }}>ᵍ°</span>
                              <span style={{ color: t.label2, fontSize: 11, ...MONO_FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b}</span>
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
            };

            return (
              <>
                {trackedNoPR.map(name => renderRow(name, true))}
                {untrackedNoPR.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px 3px", borderTop: `1px solid ${t.border}` }}>
                    <span style={{ fontSize: 9, letterSpacing: "0.08em", fontWeight: 600, color: t.label4, flex: 1 }}>NOT TRACKING</span>
                    <span style={{ fontSize: 9, color: t.label4, ...MONO_FONT }}>{untrackedNoPR.length}</span>
                  </div>
                )}
                {untrackedNoPR.map(name => renderRow(name, false))}
              </>
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
