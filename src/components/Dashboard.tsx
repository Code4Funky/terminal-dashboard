import { useState, useEffect, useRef, useCallback, useMemo, Component } from "react";
import type { ReactNode } from "react";
import { TerminalPanel } from "./TerminalPanel";
import { HistoryDrawer } from "./HistoryDrawer";
import { StatsDrawer } from "./StatsDrawer";
import { NotesDrawer } from "./NotesDrawer";
import { ClaudeAgentsDrawer } from "./ClaudeAgentsDrawer";
import { KBChatDrawer } from "./KBChatDrawer";
import { TasksDrawer } from "./TasksDrawer";
import { RepoSidebar, SIDEBAR_W, SelectedPR, TerminalTab } from "./RepoSidebar";
import { DirectoryPicker } from "./DirectoryPicker";
import { DiffDrawer } from "./DiffDrawer";
import { FileTreeDrawer } from "./FileTreeModal";
import { loadRoot, saveRoot } from "../rootMemory";
import type { FileRef } from "./FileTreeModal";
import { FileViewer } from "./FileViewer";
import { SessionSwitcher } from "./SessionSwitcher";
import { CommandPalette } from "./CommandPalette";
import type { Command } from "./CommandPalette";
import { SettingsModal } from "./SettingsModal";
import { useTheme } from "../ThemeContext";
import { useSettings } from "../SettingsContext";
import { SYS_FONT, MONO_FONT, TABULAR } from "../theme";
import { rowState, chip, dot, CLIP, CLIP_LEFT, RADIUS, RADIUS_SM, TRANSITION } from "../chrome";
import { shellQuote } from "../shell";
import type { RepoStatus } from "../hooks/useTerminal";

interface PanelState {
  id: string;
  sessionId: string;
  number: number;
  title: string;
  cwd?: string;
  gitBranch?: string;
  /** Panels sharing a group render as one split. A lone panel is a group of one. */
  groupId: string;
  /** Split axis for the whole group — the most recent split direction wins. */
  groupDir: SplitDir;
  /** Title was chosen deliberately (rename, worktree, repo), so the cwd must not overwrite it. */
  pinned?: boolean;
}

type SplitDir = "row" | "column";

/** Panes per split. Below ~300px a pane is too narrow to be useful at 924px window width. */
const MAX_PANES = 3;

type SidePanel = "stats" | "history" | "notes" | "claude-agents" | "kb-chat" | "tasks";

/** Sync freshness for the status bar — "just now", "4m ago", "2h ago". */
function sinceLabel(epochMs: number): string {
  const mins = Math.floor((Date.now() - epochMs) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

class KBChatErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, background: "#1c1c1e", color: "#FF453A", fontSize: 11, ...MONO_FONT, width: 400, flexShrink: 0, overflowY: "auto" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>KB Chat crashed:</div>
          <div style={{ color: "#FF9F0A", marginBottom: 8, wordBreak: "break-word" }}>{this.state.error.message}</div>
          <pre style={{ fontSize: 10, color: "rgba(235,235,245,0.45)", whiteSpace: "pre-wrap", margin: 0 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Strip characters invalid in filesystem paths (used for worktree directory names).
function safeDirName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function savePanels(panels: PanelState[]) {
  window.terminal.savePanels(
    panels.map((p) => ({ number: p.number, title: p.title, group: p.groupId, dir: p.groupDir, pinned: p.pinned }))
  );
}

/** Tab name for a cwd: the repo when inside a checkout, otherwise the directory itself. */
function cwdTitle(cwd: string): string {
  const repo = cwd.match(/\/Documents\/GitHub\/([^/]+)/)?.[1];
  if (repo) return repo;
  if (/^\/Users\/[^/]+$/.test(cwd)) return "~";
  return cwd.replace(/\/+$/, "").split("/").pop() || "/";
}

/** A generic placeholder name — the panel is free to take its title from the cwd. */
const isPlaceholderTitle = (title: string) => /^terminal \d+$/.test(title);

export function Dashboard() {
  const { theme, toggleTheme } = useTheme();
  const t = theme;
  const { settings } = useSettings();

  const [panels, setPanels] = useState<PanelState[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<SidePanel | null>(null);
  const [selectedPR, setSelectedPR] = useState<SelectedPR | null>(null);
  const [selectedRepoTree, setSelectedRepoTree] = useState<string | null>(null);
  // "" means the tree was closed at quit — must normalise, the linked effect treats non-null as open
  const [fileBrowseRepo, setFileBrowseRepo] = useState<string | null>(() => localStorage.getItem("tdash:file-root") || null);
  const [fileTreeLinked, setFileTreeLinked] = useState(() => localStorage.getItem("tdash:file-tree-linked") !== "0");
  const [showRootPicker, setShowRootPicker] = useState(false);

  const RAIL_W = settings.showNavLabels ? 56 : 44;
  const FIXED_W = SIDEBAR_W + RAIL_W; // sessions panel + nav rail
  const [diffWidth, setDiffWidth] = useState<number>(() => Number(localStorage.getItem("tdash:diff-width")) || Math.floor((window.innerWidth - FIXED_W) * 0.4));
  const [fileViewWidth, setFileViewWidth] = useState<number>(() => Number(localStorage.getItem("tdash:file-view-width")) || Math.floor((window.innerWidth - FIXED_W) * 0.4));
  const [fileTreeWidth, setFileTreeWidth] = useState<number>(() => Number(localStorage.getItem("tdash:file-tree-width")) || 260);
  const [fileView, setFileView] = useState<FileRef | null>(() => (fileBrowseRepo ? loadRoot(fileBrowseRepo).file : null));

  // The tree owns the root; the viewer's file is remembered against it, so switching roots parks both
  const openFile = (f: FileRef | null) => {
    setFileView(f);
    if (fileBrowseRepo) saveRoot(fileBrowseRepo, { file: f });
  };

  const diffOpen = !!(selectedPR || selectedRepoTree);
  const fileTreeOpen = !!fileBrowseRepo;
  const viewerOpen = !!fileView;
  const prevBothWide = useRef(false);

  // Terminal docked below the viewer instead of beside it — sticky, so it survives closing the file.
  const [stackTerminal, setStackTerminal] = useState(() => localStorage.getItem("tdash:term-stacked") === "1");
  const [dockHeight, setDockHeight] = useState(() => Number(localStorage.getItem("tdash:term-dock-height")) || 250);
  useEffect(() => { localStorage.setItem("tdash:term-stacked", stackTerminal ? "1" : "0"); }, [stackTerminal]);

  // ── Maximise the wide right-hand drawers ───────────────────────────────────
  type WideDrawer = "viewer" | "diff";
  const [maximizedDrawer, setMaximizedDrawer] = useState<WideDrawer | null>(null);
  const restoreWidth = useRef<Record<WideDrawer, number>>({ viewer: fileViewWidth, diff: diffWidth });
  const MIN_TERM_W = 320; // always leave a usable terminal strip

  // Split the right dock evenly when the second wide drawer opens
  useEffect(() => {
    const both = viewerOpen && diffOpen;
    if (both && !prevBothWide.current) {
      const half = Math.floor(
        (window.innerWidth - RAIL_W - (sidebarVisible ? SIDEBAR_W : 0) - (fileTreeOpen ? fileTreeWidth : 0) - MIN_TERM_W) / 2
      );
      setDiffWidth(Math.max(280, half));
      setFileViewWidth(Math.max(320, half));
    }
    prevBothWide.current = both;
  }, [viewerOpen, diffOpen]);
  const [showModal, setShowModal] = useState(false);
  const [modalRepos, setModalRepos] = useState<{ name: string }[]>([]);
  const togglePanel = (panel: SidePanel) => setActivePanel((v) => (v === panel ? null : panel));
  const handlePanelToggle = (panel: SidePanel) => {
    if (panel === "kb-chat" && activePanel !== "kb-chat") setSplitMode(true);
    togglePanel(panel);
  };
  const [zenMode, setZenMode] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    try { return localStorage.getItem("tdash:sidebar-visible") !== "false"; } catch { return true; }
  });
  const toggleSidebar = () => setSidebarVisible((v) => {
    const next = !v;
    try { localStorage.setItem("tdash:sidebar-visible", String(next)); } catch {}
    return next;
  });
  const setDrawerWidth: Record<WideDrawer, (w: number) => void> = { viewer: setFileViewWidth, diff: setDiffWidth };
  const drawerIsOpen: Record<WideDrawer, boolean> = { viewer: viewerOpen, diff: diffOpen };
  const drawerMinWidth: Record<WideDrawer, number> = { viewer: 320, diff: 280 };

  // Widest a drawer can get: window minus icon rail, sidebar, every sibling, and a terminal strip
  const maxDrawerWidth = (self: WideDrawer) => {
    const siblings = (fileTreeOpen ? fileTreeWidth : 0)
      + (self !== "viewer" && viewerOpen ? fileViewWidth : 0)
      + (self !== "diff" && diffOpen ? diffWidth : 0);
    return Math.max(drawerMinWidth[self], window.innerWidth - RAIL_W - (sidebarVisible ? SIDEBAR_W : 0) - siblings - MIN_TERM_W);
  };

  // Only one drawer is ever maximised, so toggling just restores the incumbent and flips the flag —
  // the refit effect below computes the new width once the restored sibling has settled.
  const toggleMaximized = (key: WideDrawer) => {
    const cur = maximizedDrawer;
    if (cur) setDrawerWidth[cur](restoreWidth.current[cur]);
    if (cur === key) { setMaximizedDrawer(null); return; }
    restoreWidth.current[key] = key === "viewer" ? fileViewWidth : diffWidth;
    setMaximizedDrawer(key);
  };

  // Keep the maximised drawer filling the window as it (or its neighbours) resize
  useEffect(() => {
    const key = maximizedDrawer;
    if (!key) return;
    // Closing a maximised drawer drops the state so it reopens at its normal width
    if (!drawerIsOpen[key]) { setDrawerWidth[key](restoreWidth.current[key]); setMaximizedDrawer(null); return; }
    const refit = () => setDrawerWidth[key](maxDrawerWidth(key));
    refit();
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [maximizedDrawer, viewerOpen, diffOpen, fileTreeOpen, sidebarVisible, fileTreeWidth, fileViewWidth, diffWidth]);

  const [splitMode, setSplitMode] = useState(false);
  const [termFitKey, setTermFitKey] = useState(0);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const splitDragRef = useRef<{ startX: number; startRatio: number; totalWidth: number } | null>(null);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Broadcast: keystrokes in the focused terminal mirror to every session. Off on close for safety.
  const [broadcast, setBroadcast] = useState(false);
  const [worktreeConfirm, setWorktreeConfirm] = useState<{ repoName: string; branchName: string; wtPath: string } | null>(null);
  const [dirtyConfirm, setDirtyConfirm] = useState<{ repoName: string; branchName: string; files: string[] } | null>(null);
  const [termFont, setTermFont] = useState<{ family: string; size: number; files: string[] } | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    window.terminal.getIterm2Font().then((font) => {
      setTermFont(font);
      initPanels();
    });
  }, []);

  async function initPanels() {
    window.terminal.getState().then(async ({ lastPanels }) => {
      const toRestore = lastPanels.length > 0 ? lastPanels.slice(0, 8) : null;
      if (toRestore) {
        const restored: PanelState[] = [];
        for (const saved of toRestore) {
          const { sessionId } = await window.terminal.create(220, 50, saved.number);
          // Pre-split state files have no group — each panel becomes its own
          restored.push({ id: sessionId, sessionId, number: saved.number, title: saved.title, groupId: saved.group || sessionId, groupDir: saved.dir || "row", pinned: saved.pinned });
        }
        setPanels(restored);
        const last = restored.at(-1);
        if (last) { setFocusedId(last.id); window.terminal.setFocused(last.sessionId); }
      } else {
        const { sessionId, number } = await window.terminal.create(220, 50);
        const panel: PanelState = { id: sessionId, sessionId, number, title: `terminal ${number}`, groupId: sessionId, groupDir: "row" };
        setPanels([panel]);
        setFocusedId(panel.id);
        window.terminal.setFocused(panel.sessionId);
        savePanels([panel]);
      }
    });
  }

  useEffect(() => {
    const handler = () => savePanels(panels);
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [panels]);

  useEffect(() => {
    const cleanup = window.terminal.onCwdUpdate((sessionId, cwd, gitBranch) => {
      setPanels((prev) => {
        // Every shell prompt emits an OSC update; skip the state change (and the
        // whole re-render + git-subprocess cascade) when nothing actually changed.
        let changed = false;
        const next = prev.map((p) => {
          if (p.sessionId !== sessionId) return p;
          const nextBranch = gitBranch || undefined;
          // An unpinned tab names itself after wherever the shell is now
          const title = p.pinned ? p.title : cwdTitle(cwd);
          if (p.cwd === cwd && p.gitBranch === nextBranch && p.title === title) return p;
          changed = true;
          return { ...p, cwd, gitBranch: nextBranch, title };
        });
        return changed ? next : prev;
      });
    });
    return cleanup;
  }, []);

  const focusedPanel = panels.find((p) => p.id === focusedId);
  const focusedRepo = focusedPanel?.cwd?.match(/\/Documents\/GitHub\/([^/]+)/)?.[1] ?? null;
  // The file tree browses any path; the git panels can't — so a non-repo cwd only feeds the tree
  const focusedRoot = focusedRepo ?? focusedPanel?.cwd ?? null;

  // Groups keep panel order, so ⌘1-9 and ⌘⇧↑↓ still walk the flat list predictably.
  const groups = useMemo(() => {
    const out: { id: string; dir: SplitDir; panels: PanelState[] }[] = [];
    const index = new Map<string, number>();
    for (const p of panels) {
      const at = index.get(p.groupId);
      if (at === undefined) { index.set(p.groupId, out.length); out.push({ id: p.groupId, dir: p.groupDir, panels: [p] }); }
      else out[at].panels.push(p);
    }
    return out;
  }, [panels]);
  const visibleGroupId = focusedPanel?.groupId ?? groups[0]?.id ?? null;
  const visibleGroup = groups.find((g) => g.id === visibleGroupId);
  const focusedGroupSize = visibleGroup?.panels.length ?? 0;
  const visibleGroupDir = visibleGroup?.dir ?? "row";

  // Always-current ref — read inside effects without adding to deps
  const diffOpenRef = useRef(diffOpen);
  diffOpenRef.current = diffOpen;

  // Let panel callbacks stay referentially stable (so memo'd panels skip re-render)
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;

  useEffect(() => {
    if (!fileTreeLinked || !focusedRoot) return;
    setFileBrowseRepo((prev) => (prev !== null ? focusedRoot : prev));
  }, [focusedRoot, fileTreeLinked]);

  // ── Status bar ───────────────────────────────────────────────────────────────
  const [repoStatus, setRepoStatus] = useState<RepoStatus | null>(null);
  const [sidebarSummary, setSidebarSummary] = useState({ repos: 0, prs: 0, syncedAt: null as number | null });
  const onSidebarSummary = useCallback((s: { repos: number; prs: number; syncedAt: number | null }) => setSidebarSummary(s), []);
  const [, setStatusTick] = useState(0);

  // Re-polled on every branch change too, since that's when ahead/behind actually moves.
  // The tick keeps the sync-freshness label current even with no repo focused.
  useEffect(() => {
    let live = true;
    const poll = () => {
      if (!focusedRepo) { setRepoStatus(null); return; }
      window.terminal.getRepoStatus(focusedRepo).then((s) => { if (live) setRepoStatus(s); }).catch(() => {});
    };
    poll();
    const id = setInterval(() => { poll(); setStatusTick((v) => v + 1); }, 30_000);
    return () => { live = false; clearInterval(id); };
  }, [focusedRepo, focusedPanel?.gitBranch]);

  // A root switch parks the old file and restores the new root's; closing the tree leaves the viewer up
  const prevBrowseRepo = useRef(fileBrowseRepo);
  useEffect(() => {
    if (fileBrowseRepo !== prevBrowseRepo.current) {
      localStorage.setItem("tdash:file-root", fileBrowseRepo ?? "");
      if (fileBrowseRepo && prevBrowseRepo.current) setFileView(loadRoot(fileBrowseRepo).file);
    }
    prevBrowseRepo.current = fileBrowseRepo;
  }, [fileBrowseRepo]);

  useEffect(() => { localStorage.setItem("tdash:file-tree-linked", fileTreeLinked ? "1" : "0"); }, [fileTreeLinked]);

  // When focused terminal navigates to a different repo, track it in the Git panel (only if already open)
  useEffect(() => {
    if (!focusedRepo || !diffOpenRef.current) return;
    setSelectedRepoTree(focusedRepo);
    setSelectedPR(null);
  }, [focusedRepo]);

  useEffect(() => {
    const cleanup = window.terminal.onNewPanel((sessionId, number) => {
      const panel: PanelState = { id: sessionId, sessionId, number, title: `terminal ${number}`, groupId: sessionId, groupDir: "row" };
      setPanels((prev) => {
        const next = [...prev, panel];
        savePanels(next);
        return next;
      });
      setFocusedId(sessionId);
    });
    return cleanup;
  }, []);

  const addPanel = (sessionId: string, number: number, title: string, groupId?: string) => {
    const panel: PanelState = { id: sessionId, sessionId, number, title, groupId: groupId ?? sessionId, groupDir: "row", pinned: !isPlaceholderTitle(title) };
    setPanels((prev) => { const next = [...prev, panel]; savePanels(next); return next; });
    setFocusedId(sessionId);
    window.terminal.setFocused(sessionId);
  };

  const handleRename = useCallback((panelId: string, newTitle: string) => {
    setPanels((prev) => {
      const next = prev.map((p) => p.id === panelId ? { ...p, title: newTitle, pinned: true } : p);
      savePanels(next);
      return next;
    });
  }, []);

  const focusPanel = useCallback((id: string) => {
    setFocusedId(id);
    window.terminal.setFocused(id); // panel.id === sessionId throughout
  }, []);

  const handleAddPanel = async () => {
    const { sessionId, number } = await window.terminal.create(220, 50);
    addPanel(sessionId, number, `terminal ${number}`);
  };

  // Split: a second shell beside the source, same cwd, sharing its group so both stay on screen.
  // A group has one axis, so splitting the other way re-orients every pane in it.
  const handleSplit = useCallback(async (panelId: string, dir: SplitDir = "row") => {
    const source = panelsRef.current.find((p) => p.id === panelId);
    if (!source) return;
    if (panelsRef.current.filter((p) => p.groupId === source.groupId).length >= MAX_PANES) return;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, source.cwd ? `cd ${shellQuote(source.cwd)}` : undefined);
    const panel: PanelState = { id: sessionId, sessionId, number, title: source.title, cwd: source.cwd, gitBranch: source.gitBranch, groupId: source.groupId, groupDir: dir, pinned: source.pinned };
    setPanels((prev) => {
      // Insert beside the source so pane order matches visual order
      const at = prev.findIndex((p) => p.id === panelId);
      const next = [...prev];
      next.splice(at < 0 ? prev.length : at + 1, 0, panel);
      const reoriented = next.map((p) => (p.groupId === source.groupId ? { ...p, groupDir: dir } : p));
      savePanels(reoriented);
      return reoriented;
    });
    setFocusedId(sessionId);
    window.terminal.setFocused(sessionId);
  }, []);

  // Flip an existing split between side-by-side and stacked without spawning a pane.
  const handleFlipAxis = useCallback((panelId: string) => {
    setPanels((prev) => {
      const source = prev.find((p) => p.id === panelId);
      if (!source || prev.filter((p) => p.groupId === source.groupId).length < 2) return prev;
      const dir: SplitDir = source.groupDir === "row" ? "column" : "row";
      const next = prev.map((p) => (p.groupId === source.groupId ? { ...p, groupDir: dir } : p));
      savePanels(next);
      return next;
    });
  }, []);

  const openBranchInTerminal = async (repoName: string, branchName: string, wtPath: string) => {
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${wtPath}"`);
    addPanel(sessionId, number, `${repoName}:${branchName}`);
  };

  const handleOpenBranchTerminal = async (repoName: string, branchName: string) => {
    try {
      const { exists, path } = await window.terminal.checkWorktree(repoName, branchName);
      if (exists && path) {
        openBranchInTerminal(repoName, branchName, path);
      } else {
        // No worktree — open the main repo and checkout the branch.
        // First check if there are uncommitted changes.
        const { dirty, files } = await window.terminal.checkGitDirty(repoName);
        if (dirty) {
          setDirtyConfirm({ repoName, branchName, files });
        } else {
          const repoPath = `$HOME/Documents/GitHub/${repoName}`;
          const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${repoPath}" && git checkout ${shellQuote(branchName)}`);
          addPanel(sessionId, number, `${repoName}:${branchName}`);
        }
      }
    } catch (e) {
      console.error("handleOpenBranchTerminal failed", e);
    }
  };

  const handleDirtyStashAndCheckout = async () => {
    if (!dirtyConfirm) return;
    const { repoName, branchName } = dirtyConfirm;
    setDirtyConfirm(null);
    const repoPath = `$HOME/Documents/GitHub/${repoName}`;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${repoPath}" && git stash && git checkout ${shellQuote(branchName)}`);
    addPanel(sessionId, number, `${repoName}:${branchName}`);
  };

  const handleOpenRepoTerminal = async (repoName: string, branchName: string) => {
    const repoPath = `$HOME/Documents/GitHub/${repoName}`;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${repoPath}" && git checkout ${shellQuote(branchName)}`);
    addPanel(sessionId, number, `${repoName}:${branchName}`);
  };

  const handleRunClaudeAction = async (repoName: string, branchName: string, claudeCmd: string) => {
    try {
      const { exists, path } = await window.terminal.checkWorktree(repoName, branchName);
      let cmd: string;
      if (exists && path) {
        cmd = `cd "${path}" && ${claudeCmd}`;
      } else {
        // Auto-create an isolated worktree so parallel branch runs never conflict
        const wtPath = `$HOME/Documents/GitHub/${repoName}-worktrees/${safeDirName(branchName)}`;
        cmd = `git -C "$HOME/Documents/GitHub/${repoName}" worktree add "${wtPath}" ${shellQuote(branchName)} 2>/dev/null || true && cd "${wtPath}" && ${claudeCmd}`;
      }
      const { sessionId, number } = await window.terminal.create(220, 50, undefined, cmd);
      addPanel(sessionId, number, `${repoName}:${branchName}`);
    } catch (e) {
      console.error("handleRunClaudeAction failed", e);
    }
  };

  const handleOpenInRepo = async (repoName: string) => {
    const repoPath = `$HOME/Documents/GitHub/${repoName}`;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${repoPath}"`);
    addPanel(sessionId, number, repoName);
  };

  const handleOpenDir = async (absPath: string, label: string) => {
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd ${shellQuote(absPath)}`);
    addPanel(sessionId, number, label || `terminal ${number}`);
  };

  const handleOpenSessionTerminal = async (resolvedPath: string) => {
    const name = resolvedPath.split("/").filter(Boolean).pop() ?? "session";
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${resolvedPath}"`);
    addPanel(sessionId, number, name);
  };

  const handleConfirmWorktree = async () => {
    if (!worktreeConfirm) return;
    const { repoName, branchName, wtPath } = worktreeConfirm;
    setWorktreeConfirm(null);
    const createCmd =
      `git -C "$HOME/Documents/GitHub/${repoName}" worktree add "${wtPath}" ${shellQuote(branchName)} && cd "${wtPath}"`;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, createCmd);
    addPanel(sessionId, number, `${repoName}:${branchName}`);
  };

  const handleReopen = async (num: number) => {
    const { sessionId } = await window.terminal.create(220, 50, num);
    addPanel(sessionId, num, `terminal ${num}`);
  };

  const handleResumeClaude = async (num: number, claudeSessionId: string, cwd: string) => {
    const cdPart = cwd ? `cd ${shellQuote(cwd)} && ` : "";
    const cmd = `${cdPart}claude --resume ${shellQuote(claudeSessionId)}`;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, cmd);
    addPanel(sessionId, number, `claude ${claudeSessionId.slice(0, 8)}`);
  };

  const handleClose = useCallback((panelId: string) => {
    if (panelsRef.current.length <= 1) return;
    const panel = panelsRef.current.find((p) => p.id === panelId);
    if (panel) window.terminal.close(panel.sessionId);
    setPanels((prev) => {
      const next = prev.filter((p) => p.id !== panelId);
      savePanels(next);
      if (focusedIdRef.current === panelId) {
        // Closing one pane of a split shouldn't jump to another group — stay with a sibling.
        const sibling = panel && next.find((p) => p.groupId === panel.groupId);
        const target = sibling ?? next.at(-1) ?? null;
        setFocusedId(target?.id ?? null);
        if (target) window.terminal.setFocused(target.sessionId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const fromTerminal = (e.target as HTMLElement).classList?.contains("xterm-helper-textarea");
      if (e.metaKey && !e.shiftKey && !e.altKey) {
        if (e.key === "t") { e.preventDefault(); handleAddPanel(); return; }
        if (e.key === "k") { e.preventDefault(); setShowSwitcher((v) => !v); return; }
        if (e.key === "p") { e.preventDefault(); setShowPalette((v) => !v); return; }
        if (e.key === "\\") { e.preventDefault(); setZenMode((v) => !v); return; }
        if (e.key === "b") { e.preventDefault(); toggleSidebar(); return; }
        if (e.key === ",") { e.preventDefault(); setShowSettings((v) => !v); return; }
        const digit = parseInt(e.key);
        if (digit >= 1 && digit <= 9 && panels[digit - 1]) {
          e.preventDefault();
          const target = panels[digit - 1];
          setFocusedId(target.id);
          window.terminal.setFocused(target.sessionId);
          return;
        }
      }
      if (e.metaKey && e.shiftKey && !e.altKey) {
        if (e.key === "Enter") { e.preventDefault(); if (focusedId) handleSplit(focusedId, "row"); return; }
        if (e.key === "D" || e.key === "d") { e.preventDefault(); if (focusedId) handleSplit(focusedId, "column"); return; }
        if (e.key === "R" || e.key === "r") { e.preventDefault(); if (focusedId) handleFlipAxis(focusedId); return; }
        if (e.key === "O" || e.key === "o") { e.preventDefault(); setStackTerminal((v) => !v); return; }
        if (e.key === "B" || e.key === "b") { e.preventDefault(); setBroadcast((v) => !v); return; }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          const idx = panels.findIndex((p) => p.id === focusedId);
          const prev = panels[(idx - 1 + panels.length) % panels.length];
          if (prev) { setFocusedId(prev.id); window.terminal.setFocused(prev.sessionId); }
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          const idx = panels.findIndex((p) => p.id === focusedId);
          const next = panels[(idx + 1) % panels.length];
          if (next) { setFocusedId(next.id); window.terminal.setFocused(next.sessionId); }
          return;
        }
        if (e.key === "k") {
          e.preventDefault();
          if (activePanel !== "kb-chat") {
            setActivePanel("kb-chat");
            setSplitMode(true);
          } else {
            setSplitMode((v) => !v);
          }
          return;
        }
        const TABS: SidePanel[] = ["stats", "history", "notes", "claude-agents", "kb-chat", "tasks"];
        const idx = parseInt(e.key) - 1;
        if (idx >= 0 && idx < TABS.length) {
          e.preventDefault();
          handlePanelToggle(TABS[idx]);
          return;
        }
      }
      if (e.ctrlKey && e.key === "w" && !fromTerminal) {
        e.preventDefault();
        if (focusedId) handleClose(focusedId);
      }
    };
    window.addEventListener("keydown", handleKey, { capture: true });
    return () => window.removeEventListener("keydown", handleKey, { capture: true });
  }, [focusedId, panels]);

  // Reset split mode when leaving KB chat
  useEffect(() => {
    if (activePanel !== "kb-chat") setSplitMode(false);
  }, [activePanel]);

  // Refit terminal immediately when split mode changes, and again after layout settles
  useEffect(() => {
    setTermFitKey((k) => k + 1);
    const id = setTimeout(() => setTermFitKey((k) => k + 1), 100);
    return () => clearTimeout(id);
  }, [splitMode]);

  // Terminals only yield the dock when a wide drawer can take it — never leave the row empty.
  const fillDock = !settings.showTerminal && (viewerOpen || diffOpen);

  // Stacked layout: viewer takes the full width with the terminal as a bottom dock beneath it.
  // Only reachable with the viewer open and the terminal visible — otherwise there's nothing to stack.
  const stacked = stackTerminal && viewerOpen && !fillDock && !zenMode;

  // Splitting, closing or flipping the axis reflows every pane in that group — refit them.
  useEffect(() => {
    setTermFitKey((k) => k + 1);
    const id = setTimeout(() => setTermFitKey((k) => k + 1), 80);
    return () => clearTimeout(id);
  }, [panels.length, visibleGroupDir, stacked]);

  const handleDockDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = dockHeight;
    const columnHeight = e.currentTarget.parentElement?.clientHeight ?? 800;
    // Hold the cursor for the whole drag — the handle is thin and the pointer outruns it
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      // Dragging up grows the dock, so the delta is inverted
      const next = startHeight - (ev.clientY - startY);
      setDockHeight(Math.max(120, Math.min(columnHeight - 120, next)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Refit once on release rather than per pixel — a fit per mousemove stalls the drag
      setTermFitKey((k) => k + 1);
      setDockHeight((h) => { localStorage.setItem("tdash:term-dock-height", String(h)); return h; });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Coming back from display:none the xterm has no measured size, so force a refit.
  useEffect(() => {
    if (fillDock) return;
    setTermFitKey((k) => k + 1);
    const id = setTimeout(() => setTermFitKey((k) => k + 1), 80);
    return () => clearTimeout(id);
  }, [fillDock]);

  const handleSplitDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const totalWidth = (e.currentTarget.parentElement?.clientWidth ?? 1000) - 4;
    splitDragRef.current = { startX: e.clientX, startRatio: splitRatio, totalWidth };
    const onMove = (ev: MouseEvent) => {
      if (!splitDragRef.current) return;
      const dx = ev.clientX - splitDragRef.current.startX;
      setSplitRatio(Math.max(0.25, Math.min(0.75, splitDragRef.current.startRatio + dx / splitDragRef.current.totalWidth)));
    };
    const onUp = () => {
      splitDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // One renderer for every rail item, so they all share the single selection treatment
  const railButton = (
    key: string, label: string, title: string,
    icon: ReactNode, active: boolean, onClick: () => void,
  ) => (
    <button
      key={key}
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        width: "100%", height: settings.showNavLabels ? 46 : 38, flexShrink: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
        border: "none", cursor: "pointer",
        color: active ? t.label1 : t.label3,
        ...rowState(t, active),
      }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.label2; } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.label3; } }}
    >
      {icon}
      {settings.showNavLabels && (
        <span style={{ fontSize: 9, letterSpacing: 0.2, fontWeight: active ? 600 : 400, ...SYS_FONT }}>{label}</span>
      )}
    </button>
  );

  const railDivider = <div style={{ height: 1, alignSelf: "stretch", background: t.borderSubtle, margin: "3px 10px" }} />;

  const RAIL_ICON = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  const navRail = (
    <div style={{
      width: RAIL_W, flexShrink: 0,
      background: t.surface1,
      borderRight: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column", alignItems: "stretch",
      padding: "6px 0", gap: 1, overflow: "hidden",
    }}>
      {railButton("sessions", "Sessions", sidebarVisible ? "Hide sessions (⌘B)" : "Show sessions (⌘B)",
        <svg {...RAIL_ICON}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>,
        sidebarVisible, toggleSidebar)}
      {railButton("files", "Files", "File tree and search",
        <svg {...RAIL_ICON}><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>,
        fileBrowseRepo !== null,
        () => {
          if (fileBrowseRepo) { setFileBrowseRepo(null); return; }
          setFileBrowseRepo(focusedRoot ?? "~");
          setFileTreeLinked(!!focusedRoot);
        })}
      {railButton("git", "Git", "Working tree and pull requests",
        <svg {...RAIL_ICON}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>,
        selectedRepoTree !== null || selectedPR !== null,
        () => {
          if (selectedRepoTree || selectedPR) { setSelectedRepoTree(null); setSelectedPR(null); return; }
          if (focusedRepo) { setSelectedRepoTree(focusedRepo); setSelectedPR(null); }
        })}
      {railDivider}
      {railButton("tasks", "Tasks", "Tasks  ⌘⇧6",
        <svg {...RAIL_ICON}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12l3 3 5-6"/></svg>,
        activePanel === "tasks", () => handlePanelToggle("tasks"))}
      {railButton("notes", "Notes", "Notes  ⌘⇧3",
        <svg {...RAIL_ICON}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>,
        activePanel === "notes", () => handlePanelToggle("notes"))}
      {railButton("stats", "Stats", "Stats  ⌘⇧1",
        <svg {...RAIL_ICON}><path d="M3 20h18"/><path d="M6 20v-7M12 20V5M18 20v-9"/></svg>,
        activePanel === "stats", () => handlePanelToggle("stats"))}
      {railButton("history", "History", "History  ⌘⇧2",
        <svg {...RAIL_ICON}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>,
        activePanel === "history", () => handlePanelToggle("history"))}
      {railButton("claude-agents", "Claude", "Claude agents  ⌘⇧4",
        <svg {...RAIL_ICON}><path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z"/></svg>,
        activePanel === "claude-agents", () => handlePanelToggle("claude-agents"))}
      {railButton("kb-chat", "KB", "KB chat  ⌘⇧5",
        <svg {...RAIL_ICON}><path d="M5 4h14v16H7a2 2 0 0 1-2-2z"/><path d="M5 18a2 2 0 0 1 2-2h12"/></svg>,
        activePanel === "kb-chat", () => handlePanelToggle("kb-chat"))}

      <div style={{ flex: 1 }} />

      {panels.length > 1 && railDivider}
      {panels.length > 1 && railButton("broadcast", "Send all",
        broadcast ? "Broadcast on — typing goes to all terminals (⌘⇧B)" : "Broadcast input to all terminals (⌘⇧B)",
        <svg {...RAIL_ICON}><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/></svg>,
        broadcast, () => setBroadcast((v) => !v))}
    </div>
  );

  // Rendered either as the row's own column or inside the stacked column below the viewer,
  // so the two layouts share one definition and can't drift.
  const terminalDock = (
    <div style={{
      ...(stacked
        ? { height: dockHeight, flex: "none" }
        : {
            flex: splitMode && activePanel === "kb-chat" ? splitRatio : 1,
            minWidth: splitMode && activePanel === "kb-chat" ? 300 : undefined,
          }),
      display: fillDock ? "none" : "flex",
      flexDirection: "column",
      minHeight: 0, overflow: "hidden",
      position: "relative",
    }}>
      {/* Every group is laid out at full size and hidden with visibility, not display: a
          display:none group has no box, so fit() would leave its PTYs at a stale size. */}
      {groups.map((group) => (
        <div
          key={group.id}
          style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: group.dir, gap: 4, padding: 4,
            visibility: group.id === visibleGroupId ? "visible" : "hidden",
          }}
        >
          {group.panels.map((panel) => (
            <div
              key={panel.id}
              style={{
                flex: 1, minWidth: 0, minHeight: 0, display: "flex",
                // Broadcast on: ring every live panel so it's unmistakable they all receive input.
                outline: broadcast ? `2px solid ${t.orange}` : undefined,
                outlineOffset: broadcast ? -2 : undefined,
                borderRadius: broadcast ? RADIUS : undefined,
              }}
            >
              <TerminalPanel
                id={panel.id}
                sessionId={panel.sessionId}
                panelNumber={panel.number}
                title={panel.title}
                cwd={panel.cwd}
                gitBranch={panel.gitBranch}
                focused={panel.id === focusedId}
                fontFamily={termFont?.family}
                fontSize={termFont?.size}
                onFocus={focusPanel}
                onRename={handleRename}
                canClose={panels.length > 1}
                onClose={handleClose}
                canSplit={group.panels.length < MAX_PANES}
                onSplit={handleSplit}
                splitDir={group.panels.length > 1 ? group.dir : undefined}
                onFlipAxis={handleFlipAxis}
                fitTrigger={termFitKey}
                broadcast={broadcast && panel.id === focusedId}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  const fileViewer = viewerOpen && (
    <FileViewer
      repo={fileView!.repo}
      path={fileView!.path}
      line={fileView!.line}
      match={fileView!.match}
      treeRepo={fileBrowseRepo}
      onClose={() => openFile(null)}
      width={fileViewWidth}
      onWidthChange={(w) => { setMaximizedDrawer(null); setFileViewWidth(w); localStorage.setItem("tdash:file-view-width", String(w)); }}
      maximized={maximizedDrawer === "viewer"}
      onToggleMaximize={() => toggleMaximized("viewer")}
      fill={fillDock || stacked}
      stacked={stacked}
      onToggleStacked={() => setStackTerminal((v) => !v)}
    />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: t.bg, overflow: "hidden" }}>
      {/* Title bar */}
      <div style={{
        display: "flex", alignItems: "center",
        gap: 8, height: 38, padding: "0 8px 0 80px",
        background: t.surface1,
        backdropFilter: t.backdropFilter,
        WebkitBackdropFilter: t.backdropFilter,
        borderBottom: `1px solid ${t.border}`,
        flexShrink: 0,
        WebkitAppRegion: "drag" as const,
        position: "relative", zIndex: 10,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: t.label1, flexShrink: 0, ...SYS_FONT }}>
          Flight Deck
        </span>
        {focusedRepo && (
          <span style={{ fontSize: 11, color: t.label3, maxWidth: 180, ...MONO_FONT, ...CLIP }}>{focusedRepo}</span>
        )}

        <div style={{ flex: 1 }} />

        {/* Docked search — absolute-centred so side controls don't shift it; opens the ⌘P palette */}
        <button
          onClick={() => setShowPalette(true)}
          title="Search (⌘P)"
          style={{
            position: "absolute", left: "50%", transform: "translateX(-50%)",
            display: "flex", alignItems: "center", gap: 7,
            width: 440, maxWidth: "42vw", height: 26, padding: "0 6px 0 8px",
            background: t.surface0,
            border: `1px solid ${t.borderMid}`, borderRadius: RADIUS,
            color: t.label3, cursor: "text",
            WebkitAppRegion: "no-drag" as const, transition: TRANSITION,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = t.surface0; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span style={{ fontSize: 12, ...SYS_FONT, ...CLIP }}>Search sessions, agents, files…</span>
          <span style={{ ...chip(t), marginLeft: "auto" }}>⌘P</span>
        </button>

        <span
          title={`${panels.length} session${panels.length !== 1 ? "s" : ""} running`}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            height: 20, padding: "0 7px", borderRadius: RADIUS_SM,
            background: t.surface2, border: `1px solid ${t.borderSubtle}`,
            fontSize: 11, color: t.label2, flexShrink: 0,
            WebkitAppRegion: "no-drag" as const, ...MONO_FONT, ...TABULAR,
          }}
        >
          <span style={dot(t, panels.length ? "running" : "idle")} />
          {panels.length} running
        </span>

        <button
          onClick={() => setZenMode((v) => !v)}
          title={zenMode ? "Exit zen mode (⌘\\)" : "Zen mode (⌘\\)"}
          aria-label={zenMode ? "Exit zen mode" : "Zen mode"}
          aria-pressed={zenMode}
          style={{
            width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
            border: "none", borderRadius: RADIUS, cursor: "pointer", fontSize: 12, flexShrink: 0,
            color: zenMode ? t.label1 : t.label3,
            WebkitAppRegion: "no-drag" as const,
            ...rowState(t, zenMode),
          }}
          onMouseEnter={(e) => { if (!zenMode) { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.label1; } }}
          onMouseLeave={(e) => { if (!zenMode) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.label3; } }}
        >⊡</button>

        <button
          onClick={toggleTheme}
          title="Cycle theme"
          aria-label="Cycle theme"
          style={{
            width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: "none", borderRadius: RADIUS,
            color: t.label3, cursor: "pointer", fontSize: 13, flexShrink: 0,
            WebkitAppRegion: "no-drag" as const, transition: TRANSITION,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.label1; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.label3; }}
        >{{ breeze: "◑", dark: "☀", slack: "◐", light: "☾" }[t.name]}</button>

        <button
          onClick={() => setShowSettings(true)}
          title="Settings (⌘,)"
          aria-label="Settings"
          style={{
            width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: "none", borderRadius: RADIUS,
            color: t.label3, cursor: "pointer", flexShrink: 0,
            WebkitAppRegion: "no-drag" as const, transition: TRANSITION,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.label1; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.label3; }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>

      {showModal && (
        <DirectoryPicker
          onClose={() => setShowModal(false)}
          onOpenDir={handleOpenDir}
          repos={modalRepos}
        />
      )}

      {showRootPicker && (
        <DirectoryPicker
          onClose={() => setShowRootPicker(false)}
          onOpenDir={(absPath) => { setFileTreeLinked(false); setFileBrowseRepo(absPath); }}
          repos={modalRepos}
          initialPath={fileBrowseRepo?.startsWith("/") ? fileBrowseRepo : undefined}
          title="Browse files"
          openLabel="Browse here"
          openHint="browse files"
        />
      )}

      {/* Worktree confirmation modal */}
      {worktreeConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: t.surface1, border: `1px solid ${t.border}`,
            borderRadius: RADIUS, padding: "24px 28px", width: 420,
            boxShadow: "0 8px 48px rgba(0,0,0,0.4)",
          }}>
            <div style={{ color: t.label1, fontWeight: 600, fontSize: 15, marginBottom: 8, ...SYS_FONT }}>
              Create worktree?
            </div>
            <div style={{ color: t.label2, fontSize: 12, marginBottom: 16, lineHeight: 1.6, ...SYS_FONT }}>
              No existing worktree found for{" "}
              <span style={{ color: t.purple, ...MONO_FONT }}>{worktreeConfirm.branchName}</span>
              {". A new one will be created at:"}
            </div>
            <div style={{
              background: t.surface2, border: `1px solid ${t.borderMid}`,
              borderRadius: RADIUS, padding: "8px 12px", marginBottom: 20,
              color: t.teal, fontSize: 11, ...MONO_FONT, wordBreak: "break-all",
            }}>
              {worktreeConfirm.wtPath}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setWorktreeConfirm(null)}
                style={{
                  background: t.surface2, border: `1px solid ${t.border}`,
                  borderRadius: RADIUS, color: t.label2, cursor: "pointer",
                  fontSize: 12, fontWeight: 600, padding: "7px 18px", ...SYS_FONT,
                }}
              >Cancel</button>
              <button
                onClick={handleConfirmWorktree}
                style={{
                  background: t.blue, border: "none", borderRadius: RADIUS,
                  color: "#FFFFFF", cursor: "pointer",
                  fontSize: 12, fontWeight: 600, padding: "7px 20px", ...SYS_FONT,
                }}
              >Create &amp; Open</button>
            </div>
          </div>
        </div>
      )}

      {/* Dirty files confirmation modal */}
      {dirtyConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: t.surface1, border: `1px solid ${t.border}`,
            borderRadius: RADIUS, padding: "24px 28px", width: 440,
            boxShadow: "0 8px 48px rgba(0,0,0,0.4)",
          }}>
            <div style={{ color: t.orange, fontWeight: 600, fontSize: 15, marginBottom: 8, ...SYS_FONT }}>
              Uncommitted changes detected
            </div>
            <div style={{ color: t.label2, fontSize: 12, marginBottom: 12, lineHeight: 1.6, ...SYS_FONT }}>
              <span style={{ color: t.label1 }}>{dirtyConfirm.repoName}</span> has unsaved changes.
              Stage or stash them before checking out{" "}
              <span style={{ color: t.purple, ...MONO_FONT }}>{dirtyConfirm.branchName}</span>.
            </div>
            <div style={{
              background: t.surface2, border: `1px solid ${t.borderMid}`,
              borderRadius: RADIUS, padding: "8px 12px", marginBottom: 20,
              maxHeight: 120, overflowY: "auto",
            }}>
              {dirtyConfirm.files.slice(0, 20).map((f) => (
                <div key={f} style={{ fontSize: 11, ...MONO_FONT, color: t.orange, lineHeight: 1.7 }}>{f}</div>
              ))}
              {dirtyConfirm.files.length > 20 && (
                <div style={{ fontSize: 11, color: t.label4, ...MONO_FONT }}>
                  …and {dirtyConfirm.files.length - 20} more
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setDirtyConfirm(null)}
                style={{
                  background: t.surface2, border: `1px solid ${t.border}`,
                  borderRadius: RADIUS, color: t.label2, cursor: "pointer",
                  fontSize: 12, fontWeight: 600, padding: "7px 18px", ...SYS_FONT,
                }}
              >Cancel</button>
              <button
                onClick={handleDirtyStashAndCheckout}
                style={{
                  background: t.orange, border: "none", borderRadius: RADIUS,
                  color: "#FFFFFF", cursor: "pointer",
                  fontSize: 12, fontWeight: 600, padding: "7px 20px", ...SYS_FONT,
                }}
              >Stash &amp; Checkout</button>
            </div>
          </div>
        </div>
      )}

      {/* Content row */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden", position: "relative", zIndex: 1 }}>
        {!zenMode && navRail}
        {!zenMode && sidebarVisible && (
          <RepoSidebar
            tabs={panels.map((p): TerminalTab => ({ id: p.id, number: p.number, title: p.title, cwd: p.cwd, gitBranch: p.gitBranch }))}
            focusedId={focusedId}
            onFocusTab={(id) => { setFocusedId(id); const p = panels.find((x) => x.id === id); if (p) window.terminal.setFocused(p.sessionId); }}
            onCloseTab={handleClose}
            onAddTab={() => setShowModal(true)}
            selected={selectedPR}
            onSelectPR={(pr) => { setSelectedPR(pr); if (pr) setSelectedRepoTree(null); }}
            onOpenTerminal={handleOpenBranchTerminal}
            onOpenRepoTerminal={handleOpenInRepo}
            onSelectRepoTree={(name) => { setSelectedRepoTree(name); setSelectedPR(null); }}
            onRunClaudeAction={(repo, branch, cmd) => { handleRunClaudeAction(repo, branch, cmd); }}
            onReposLoaded={setModalRepos}
            onCheckoutBranch={(repoName, branch) => { window.terminal.writeToFocusedTerminal(`cd ~/Documents/GitHub/${repoName} && git checkout ${branch}\n`); }}
            onBrowseFiles={(name) => {
              if (fileBrowseRepo === name) { setFileBrowseRepo(null); return; }
              setFileTreeLinked(false);
              setFileBrowseRepo(name);
            }}
            onSummary={onSidebarSummary}
          />
        )}
        {!zenMode && fileBrowseRepo && (
          <FileTreeDrawer
            repoName={fileBrowseRepo}
            onClose={() => setFileBrowseRepo(null)}
            linked={fileTreeLinked}
            onToggleLink={() => setFileTreeLinked((v) => !v)}
            allRepos={modalRepos.map((r) => r.name)}
            width={fileTreeWidth}
            onWidthChange={(w) => { setFileTreeWidth(w); localStorage.setItem("tdash:file-tree-width", String(w)); }}
            selected={fileView}
            onSelectFile={openFile}
            onPickRoot={() => setShowRootPicker(true)}
          />
        )}
        {stacked ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            {fileViewer}
            <div
              onMouseDown={handleDockDragStart}
              style={{
                height: 9, margin: "-4px 0", flexShrink: 0, zIndex: 10, position: "relative",
                cursor: "row-resize", display: "flex", alignItems: "center",
              }}
              onMouseEnter={(e) => ((e.currentTarget.firstElementChild as HTMLElement).style.background = t.blue)}
              onMouseLeave={(e) => ((e.currentTarget.firstElementChild as HTMLElement).style.background = t.border)}
            >
              <div style={{ height: 1, width: "100%", background: t.border, transition: "background 0.15s" }} />
            </div>
            {terminalDock}
          </div>
        ) : terminalDock}

        {!zenMode && activePanel === "stats" && <StatsDrawer onClose={() => setActivePanel(null)} onOpenSession={handleOpenSessionTerminal} />}
        {!zenMode && activePanel === "history" && (
          <HistoryDrawer openNumbers={panels.map((p) => p.number)} onReopen={handleReopen} onResumeClaude={handleResumeClaude} onClose={() => setActivePanel(null)} />
        )}
        {!zenMode && activePanel === "notes" && <NotesDrawer onClose={() => setActivePanel(null)} />}
        {!zenMode && activePanel === "claude-agents" && <ClaudeAgentsDrawer onClose={() => setActivePanel(null)} onOpenTerminal={handleOpenSessionTerminal} />}
        {!zenMode && activePanel === "tasks" && <TasksDrawer onClose={() => setActivePanel(null)} />}
        {splitMode && !zenMode && activePanel === "kb-chat" && (
          <div
            onMouseDown={handleSplitDragStart}
            style={{ width: 4, flexShrink: 0, cursor: "col-resize", background: "transparent", transition: "background 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = `${t.purple}40`)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          />
        )}
        {!zenMode && activePanel === "kb-chat" && (
          <KBChatErrorBoundary>
            <KBChatDrawer
              onClose={() => { setActivePanel(null); setSplitMode(false); }}
              splitMode={splitMode}
              onToggleSplit={() => setSplitMode((v) => !v)}
            />
          </KBChatErrorBoundary>
        )}

        {/* Stacked mode renders the viewer inside the terminal column instead */}
        {!zenMode && !stacked && fileViewer}

        {!zenMode && (selectedPR || selectedRepoTree) && (
          <DiffDrawer
            repoName={selectedPR?.repoName ?? selectedRepoTree!}
            prNumber={selectedPR?.prNumber}
            prTitle={selectedPR?.prTitle}
            prUrl={selectedPR?.prUrl}
            headRefName={selectedPR?.branch}
            onClose={() => { setSelectedPR(null); setSelectedRepoTree(null); }}
            width={diffWidth}
            onWidthChange={(w) => { setMaximizedDrawer(null); setDiffWidth(w); localStorage.setItem("tdash:diff-width", String(w)); }}
            maximized={maximizedDrawer === "diff"}
            onToggleMaximize={() => toggleMaximized("diff")}
            fill={fillDock}
          />
        )}

        {showSwitcher && (
          <SessionSwitcher
            tabs={panels.map((p) => ({ id: p.id, title: p.title, cwd: p.cwd, gitBranch: p.gitBranch }))}
            focusedId={focusedId}
            onSelect={(id) => { setFocusedId(id); const p = panels.find((x) => x.id === id); if (p) window.terminal.setFocused(p.sessionId); }}
            onClose={() => setShowSwitcher(false)}
          />
        )}

        {showPalette && (
          <CommandPalette
            onClose={() => setShowPalette(false)}
            focusedRepo={focusedRepo}
            repos={modalRepos}
            actions={{
              openRepo: handleOpenInRepo,
              reopenSession: handleReopen,
              runNote: (command) => { window.terminal.writeToFocusedTerminal(command); },
              openAgentFile: (filename) => { window.terminal.openClaudeFile(`~/.claude/agents/${filename}`); },
              openFile: (repo, path) => { window.terminal.openRepoFile(repo, path); },
            }}
            commands={[
              { id: "new-terminal", section: "Terminal", title: "New terminal", hint: "⌘T", keywords: "open create", run: () => { handleAddPanel(); } },
              { id: "close-panel", section: "Terminal", title: "Close focused panel", hint: "⌃W", keywords: "kill remove", run: () => { if (focusedId) handleClose(focusedId); } },
              ...(panels.length > 1 ? [
                ...(focusedId && focusedGroupSize < MAX_PANES
                  ? [
                      { id: "split-right", section: "Terminal", title: "Split terminal right", hint: "⌘⇧⏎", keywords: "split pane side by side vertical", run: () => handleSplit(focusedId, "row") },
                      { id: "split-down", section: "Terminal", title: "Split terminal down", hint: "⌘⇧D", keywords: "split pane below horizontal stack", run: () => handleSplit(focusedId, "column") },
                    ]
                  : []),
                ...(focusedId && focusedGroupSize > 1
                  ? [{ id: "flip-split", section: "Terminal", title: visibleGroupDir === "row" ? "Stack split vertically" : "Place split side by side", hint: "⌘⇧R", keywords: "flip rotate axis orientation split", run: () => handleFlipAxis(focusedId) }]
                  : []),
                { id: "stack-terminal", section: "Terminal", title: stackTerminal ? "Terminal beside the file" : "Terminal below the file", hint: "⌘⇧O", keywords: "dock bottom stack layout viewer", run: () => setStackTerminal((v) => !v) },
                { id: "toggle-broadcast", section: "Terminal", title: broadcast ? "Stop broadcasting input" : "Broadcast input to all terminals", hint: "⌘⇧B", keywords: "broadcast mirror all", run: () => setBroadcast((v) => !v) },
              ] as Command[] : []),
              ...panels.map((p, i): Command => ({
                id: `goto-${p.id}`, section: "Go to panel", title: p.title,
                hint: i < 9 ? `⌘${i + 1}` : undefined,
                keywords: `${p.number} ${p.cwd ?? ""} ${p.gitBranch ?? ""}`,
                run: () => focusPanel(p.id),
              })),
              { id: "switcher", section: "Panels", title: "Session switcher", hint: "⌘K", keywords: "jump find", run: () => setShowSwitcher(true) },
              { id: "stats", section: "Panels", title: "Stats", hint: "⌘⇧1", run: () => handlePanelToggle("stats") },
              { id: "history", section: "Panels", title: "History", hint: "⌘⇧2", run: () => handlePanelToggle("history") },
              { id: "notes", section: "Panels", title: "Notes", hint: "⌘⇧3", run: () => handlePanelToggle("notes") },
              { id: "claude-agents", section: "Panels", title: "Claude Agents", hint: "⌘⇧4", run: () => handlePanelToggle("claude-agents") },
              { id: "kb-chat", section: "Panels", title: "KB Chat", hint: "⌘⇧5", run: () => handlePanelToggle("kb-chat") },
              { id: "tasks", section: "Panels", title: "Tasks", hint: "⌘⇧6", run: () => handlePanelToggle("tasks") },
              { id: "settings", section: "View", title: "Settings", hint: "⌘,", keywords: "preferences config", run: () => setShowSettings(true) },
              { id: "zen", section: "View", title: zenMode ? "Exit zen mode" : "Zen mode", hint: "⌘\\", keywords: "focus fullscreen", run: () => setZenMode((v) => !v) },
              { id: "sidebar", section: "View", title: sidebarVisible ? "Hide sidebar" : "Show sidebar", hint: "⌘B", keywords: "repos", run: toggleSidebar },
              { id: "theme", section: "View", title: "Cycle theme", keywords: "dark light slack appearance colour color", run: toggleTheme },
            ]}
          />
        )}

      </div>

      {/* Status bar */}
      {!zenMode && (
        <div style={{
          height: 26, flexShrink: 0, display: "flex", alignItems: "center", gap: 10,
          padding: "0 10px", background: t.surface1, borderTop: `1px solid ${t.border}`,
          fontSize: 11, color: t.label3, ...MONO_FONT, ...TABULAR,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}>
          {repoStatus ? (
            <>
              <span style={{ flex: "0 1 auto", color: t.label2, maxWidth: 260, ...CLIP_LEFT }} title={repoStatus.branch}>
                ⎇ {repoStatus.branch}
              </span>
              {(repoStatus.ahead > 0 || repoStatus.behind > 0) && (
                <span style={{ flex: "none" }}>
                  {repoStatus.ahead > 0 && <span style={{ color: t.green }}>↑{repoStatus.ahead}</span>}
                  {repoStatus.ahead > 0 && repoStatus.behind > 0 && " "}
                  {repoStatus.behind > 0 && <span style={{ color: t.orange }}>↓{repoStatus.behind}</span>}
                </span>
              )}
              <span style={{ flex: "none", color: repoStatus.changed > 0 ? t.label2 : t.label4 }}>
                {repoStatus.changed} changed
              </span>
            </>
          ) : (
            <span style={{ flex: "0 1 auto", color: t.label4, ...CLIP }}>No repo</span>
          )}

          <span style={{ flex: 1, minWidth: 0 }} />

          <span style={{ flex: "none", color: sidebarSummary.prs > 0 ? t.label2 : t.label4 }}>
            {sidebarSummary.prs} open PRs
          </span>
          <span style={{ flex: "none", color: t.label4 }}>{sidebarSummary.repos} repos</span>
          <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={dot(t, sidebarSummary.syncedAt ? "running" : "idle")} />
            {sidebarSummary.syncedAt ? `synced ${sinceLabel(sidebarSummary.syncedAt)}` : "not synced"}
          </span>
        </div>
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {broadcast && (
        <div
          style={{
            position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)",
            zIndex: 200, display: "flex", alignItems: "center", gap: 8,
            background: t.orange, color: "#1a1200", borderRadius: RADIUS,
            padding: "5px 12px 5px 10px", fontSize: 11.5, fontWeight: 600, ...SYS_FONT,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)", pointerEvents: "auto", cursor: "pointer",
          }}
          onClick={() => setBroadcast(false)}
          title="Click to stop broadcasting"
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#1a1200" }} />
          Broadcasting to all terminals — ⌘⇧B to stop
        </div>
      )}
    </div>
  );
}
