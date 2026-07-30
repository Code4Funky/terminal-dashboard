import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import type { TaskSummary } from "../types/tasks";
// Lives with the hook, not a component: without it xterm's panes lose absolute positioning and
// paint outside their host.
import "@xterm/xterm/css/xterm.css";

// One shape for both the repo fan-out and search hydration, so their results are interchangeable.
export type GhPRNode = {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  headRefOid: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  reviewDecision: string | null;
  author: { login: string };
  repository: { name: string; nameWithOwner: string };
  additions?: number;
  deletions?: number;
  reviewRequests: { __typename: string; login?: string; name?: string; slug?: string }[];
  statusCheckRollup: { __typename: string; status?: string; conclusion: string | null; state?: string }[];
  mergeable: string;
  mergeStateStatus: string;
};

declare global {
  interface Window {
    terminal: {
      getState: () => Promise<{
        terminalCounter: number;
        lastPanels: { number: number; title: string; group?: string; dir?: "row" | "column"; pinned?: boolean }[];
      }>;
      create: (
        cols: number,
        rows: number,
        panelNumber?: number,
        initialCommand?: string
      ) => Promise<{ sessionId: string; number: number }>;
      getHistory: (num: number) => Promise<string>;
      /** Panel number → epoch ms of its last PTY output. */
      getActivity: () => Promise<Record<number, number>>;
      listHistory: () => Promise<{ number: number; size: number; lastModified: number; title?: string }[]>;
      savePanels: (panels: { number: number; title: string; group?: string; dir?: "row" | "column"; pinned?: boolean }[]) => void;
      write: (id: string, data: string) => void;
      resize: (id: string, cols: number, rows: number) => void;
      close: (id: string) => void;
      deleteHistory: (num: number) => void;
      onOutput: (id: string, cb: (data: string) => void) => () => void;
      onExit: (id: string, cb: () => void) => () => void;
      onNewPanel: (
        cb: (sessionId: string, number: number) => void
      ) => () => void;
      onCwdUpdate: (cb: (sessionId: string, cwd: string, gitBranch: string) => void) => () => void;
      setFocused: (sessionId: string) => void;
      setBackgroundColor: (color: string) => void;
      getIterm2Font: () => Promise<{ family: string; size: number; files: string[] } | null>;
      getStats: (month?: string) => Promise<{
        claude: {
          currentMonth: string;
          totalSessions: number;
          monthSessions: number;
          totalMessages: number;
          monthMessages: number;
          totalInputTokens: number;
          totalOutputTokens: number;
          totalCacheReadTokens: number;
          totalCacheCreationTokens: number;
          monthInputTokens: number;
          monthOutputTokens: number;
          monthCacheReadTokens: number;
          monthCacheCreationTokens: number;
          estimatedCost: number;
          modelBreakdown: { model: string; cost: number; costContent: number; costCache: number; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number }[];
          dailyCounts: { date: string; count: number }[];
          dailyTokens: { date: string; tokens: number }[];
        };
        repos: { name: string; visits: number; lastSeen: number }[];
      }>;
      listClaudeSessions: () => Promise<{ filename: string; size: number; lastModified: number }[]>;
      readClaudeSession: (filename: string) => Promise<{ role: string; content: string; timestamp?: string }[]>;
      listClaudeAgents: () => Promise<{ name: string; description: string; model?: string; color?: string; tools: string[]; filename: string }[]>;
      listClaudeCommands: () => Promise<{ name: string; description: string; filename: string }[]>;
      listClaudeSkills: () => Promise<{ name: string; description: string }[]>;
      listClaudeHooks: () => Promise<{ event: string; matcher?: string; command: string }[]>;
      onClaudeConfigChanged: (cb: () => void) => () => void;
      getPanelClaudeSessions: (panelNumber: number) => Promise<{ claudeSessionId: string; cwd: string; startedAt: number }[]>;
      getAllPanelClaudeSessions: () => Promise<Record<number, { claudeSessionId: string; cwd: string; startedAt: number }[]>>;
      getClaudeHookStatus: () => Promise<{ scriptPath: string; installed: boolean; taskScriptPath: string; taskInstalled: boolean }>;
      installClaudeHook: () => Promise<{ ok: boolean; error?: string }>;
      getAllClaudeTasks: () => Promise<TaskSummary[]>;
      getPanelTasks: (panelNumber: number) => Promise<TaskSummary[]>;
      installTaskHook: () => Promise<{ ok: boolean; error?: string }>;
      addManualTask: (subject: string) => Promise<TaskSummary | null>;
      toggleManualTask: (taskId: string) => Promise<TaskSummary | null>;
      removeManualTask: (taskId: string) => Promise<TaskSummary | null>;
      deleteTodoFileItem: (filePath: string, index: number) => Promise<boolean>;
      clearCompletedTodoFileItems: (filePath: string) => Promise<number>;
      rescanTodoFiles: () => Promise<number>;
      onClaudeSessionRecorded: (cb: (panelNumber: number, claudeSessionId: string) => void) => () => void;
      onClaudeTasksUpdated: (cb: (summary: TaskSummary) => void) => () => void;
      openClaudeFile: (filepath: string) => Promise<void>;
      listClaudeMemoryFiles: () => Promise<{ path: string; label: string; size: number }[]>;
      readClaudeMemoryFile: (filepath: string) => Promise<string>;
      getClaudeActiveCount: () => Promise<number>;
      writeToFocusedTerminal: (text: string) => Promise<void>;
      checkWorktree: (repoName: string, branchName: string) => Promise<{ exists: boolean; path: string | null }>;
      checkGitDirty: (repoName: string) => Promise<{ dirty: boolean; files: string[] }>;
      listLocalBranches: () => Promise<{ repo: string; branch: string; repoUrl: string }[]>;
      deleteBranches: (repo: string, branches: string[]) => Promise<{ deleted: string[]; failed: { branch: string; reason: string }[] }>;
      cleanupMerged: (repo: string) => Promise<{ deleted: string[]; failed: { branch: string; reason: string }[] }>;
      listPRs: (repoNames: string[]) => Promise<GhPRNode[]>;
      // Identity only — search can't return headRef/CI/diff fields; pass the refs to hydratePRs.
      searchPRRefs: (view: string) => Promise<{ nameWithOwner: string; number: number }[]>;
      hydratePRs: (refs: { nameWithOwner: string; number: number }[]) => Promise<GhPRNode[]>;
      getPRDiff: (repoName: string, prNumber: number) => Promise<string>;
      getGhLogin: () => Promise<string | null>;
      getMyTeams: () => Promise<string[]>;
      openExternal: (url: string) => Promise<void>;
      // repoOrPath: a bare repo name (under ~/Documents/GitHub) or an absolute / ~-prefixed root
      openFolder: (repoOrPath: string) => Promise<void>;
      listDir: (repoOrPath: string, subdir: string) => Promise<{ name: string; isDir: boolean; path: string }[]>;
      listDirs: (path?: string, showHidden?: boolean) => Promise<{ path: string; parent: string | null; home: string; entries: { name: string; path: string; count: number | null }[] }>;
      getFrequentDirs: () => Promise<{ name: string }[]>;
      listFiles: (repoOrPath: string) => Promise<string[]>;
      grepMatches: (repoOrPath: string, query: string, limit?: number, mode?: { caseSensitive?: boolean; regex?: boolean }) => Promise<{ hits: GrepHit[]; totalFiles: number; badPattern?: boolean; truncated?: boolean; timedOut?: boolean }>;
      openRepoFile: (repoOrPath: string, filePath: string) => Promise<void>;
      readRepoFile: (repoOrPath: string, filePath: string) => Promise<string | null>;
      writeRepoFile: (repoOrPath: string, filePath: string, content: string) => Promise<{ ok: boolean; error?: string }>;
      watchRepoFile: (repoOrPath: string, filePath: string) => Promise<void>;
      unwatchRepoFile: () => Promise<void>;
      onFileChanged: (cb: (repo: string, filePath: string, content: string) => void) => () => void;
      openInEditor: (repoOrPath: string, filePath: string, editor: string) => Promise<void>;
      showInFinder: (repoOrPath: string, filePath: string) => Promise<void>;
      getRepoBranch: (repoName: string) => Promise<string | null>;
      getWorkingTree: (repoName: string) => Promise<{
        staged: { path: string; filename: string; dir: string; status: string; additions: number; deletions: number }[];
        unstaged: { path: string; filename: string; dir: string; status: string; additions: number; deletions: number }[];
      }>;
      getChangeCount: (repoName: string) => Promise<number>;
      getRepoStatus: (repoOrPath: string) => Promise<RepoStatus | null>;
      getFileDiff: (repoName: string, filePath: string, staged: boolean) => Promise<string>;
      stageFile: (repoName: string, filePath: string) => Promise<void>;
      unstageFile: (repoName: string, filePath: string) => Promise<void>;
      stageAll: (repoName: string) => Promise<void>;
      unstageAll: (repoName: string) => Promise<void>;
      discardUnstaged: (repoName: string) => Promise<void>;
      gitCommit: (repoName: string, message: string) => Promise<void>;
      getCommits: (repoName: string, headRefName: string, prNumber?: number) => Promise<{ hash: string; subject: string; author: string; date: string; isMerge: boolean; additions: number; deletions: number }[]>;
      getCommitDiff: (repoName: string, hash: string) => Promise<string>;
      cloneRepository: (url: string, requestId: string) => void;
      onCloneProgress: (requestId: string, cb: (text: string) => void) => () => void;
      onCloneDone: (requestId: string, cb: (repoName: string) => void) => () => void;
      onCloneError: (requestId: string, cb: (error: string) => void) => () => void;
      listClaudeWorktrees: () => Promise<{ repo: string; branch: string; path: string; merged: boolean }[]>;
      removeClaudeWorktree: (repoName: string, wtPath: string) => Promise<void>;
      listGithubRepos: () => Promise<{ name: string; branches: string[]; repoUrl: string }[]>;
      listNotes: () => Promise<{ id: string; title: string; command: string; description?: string; type?: "command" | "note"; body?: string }[]>;
      saveNote: (card: { id: string; title: string; command: string; description?: string; type?: "command" | "note"; body?: string }) => void;
      deleteNote: (id: string) => void;
      getClaudeLimits: () => Promise<{
        five_hour: { utilization: number; resets_at: string | null };
        seven_day: { utilization: number; resets_at: string | null };
        extra_usage: { monthly_limit: number; used_credits: number; utilization: number } | null;
        org_id: string;
      } | null>;
      getUsageSessions: () => Promise<{
        sessionId: string; totalCost: number; totalTokens: number;
        inputTokens: number; outputTokens: number; lastActivity: string;
        modelsUsed: string[]; resolvedPath: string | null;
      }[]>;
      getChatSettings: () => Promise<{ model: string; wikiDir: string }>;
      saveChatSettings: (data: { model: string; wikiDir: string }) => void;
      pickChatWikiDir: () => Promise<string | null>;
      sendChatMessage: (params: { requestId: string; message: string; sessionId: string | null; mode: "kb" | "code"; wikiContext?: string; model?: string }) => void;
      loadChatWikiPages: () => Promise<{ name: string; content: string }[]>;
      loadChatSessions: () => Promise<unknown[]>;
      saveChatSessions: (data: unknown[]) => void;
      stopChat: (requestId: string) => void;
      onChatChunk: (requestId: string, cb: (text: string) => void) => () => void;
      onChatSessionId: (requestId: string, cb: (sessionId: string) => void) => () => void;
      onChatDone: (requestId: string, cb: () => void) => () => void;
      onChatError: (requestId: string, cb: (error: string) => void) => () => void;
      onChatUsage: (requestId: string, cb: (usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }) => void) => () => void;
      onChatToolActivity: (requestId: string, cb: (toolName: string) => void) => () => void;
      getLinearIssues: () => Promise<LinearIssuesState>;
      syncLinear: () => Promise<LinearIssuesState>;
      onLinearIssuesUpdated: (cb: (state: LinearIssuesState) => void) => () => void;
    };
  }
}

/** One content-search hit: the file, how many times it matches, and the first matching line. */
export interface GrepHit { file: string; count: number; line: number; preview: string }

/** What the status bar shows for the focused repo. */
export interface RepoStatus { branch: string; ahead: number; behind: number; changed: number }

interface LinearIssuesState {
  issues: {
    id: string; identifier: string; title: string; priority: number;
    state: { name: string; type: string; color: string };
    team: { name: string }; url: string; updatedAt: string;
  }[];
  lastSyncedAt: number | null;
  error: string | null;
}

const TERM_DARK = {
  background: "#14191e", foreground: "#dbdbdb", cursor: "#fefffe",
  selectionBackground: "#3a4a5a",
  black: "#14191e", red: "#b43c29", green: "#00c200", yellow: "#c7c400",
  blue: "#2743c7", magenta: "#bf3fbd", cyan: "#00c5c7", white: "#c7c7c7",
  brightBlack: "#5c6773", brightRed: "#dc7974", brightGreen: "#57e690",
  brightYellow: "#ece100", brightBlue: "#a6aaf1", brightMagenta: "#e07de0",
  brightCyan: "#5ffdff", brightWhite: "#feffff",
};

const TERM_LIGHT = {
  background: "#FEFEFE", foreground: "#1a1a1a", cursor: "#222222",
  selectionBackground: "#b0cff5",
  black: "#2e3436", red: "#cc0000", green: "#4e9a06", yellow: "#c4a000",
  blue: "#3465a4", magenta: "#75507b", cyan: "#06989a", white: "#d3d7cf",
  brightBlack: "#555753", brightRed: "#ef2929", brightGreen: "#8ae234",
  brightYellow: "#fce94f", brightBlue: "#729fcf", brightMagenta: "#ad7fa8",
  brightCyan: "#34e2e2", brightWhite: "#eeeeec",
};

// Highlight all matches + overview-ruler ticks; ruler colors are required by the type.
const SEARCH_DECORATIONS = {
  matchBackground: "#8a7a00",
  matchOverviewRuler: "#c7c400",
  activeMatchBackground: "#c7c400",
  activeMatchColorOverviewRuler: "#00c200",
};

export interface SearchResults { resultIndex: number; resultCount: number }

export interface TermOptions {
  scrollback?: number;
  cursorStyle?: "bar" | "block" | "underline";
  cursorBlink?: boolean;
  rendererType?: "webgl" | "dom";
  /** Off for a mirror of a session owned elsewhere — two views would otherwise fight over the PTY size. */
  ownsPtySize?: boolean;
}

export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  sessionId: string | null,
  panelNumber: number | null,
  fontFamily = "MesloLGS NF, Monaco, monospace",
  fontSize = 12,
  isDark = true,
  opts: TermOptions = {}
) {
  const { scrollback = 10000, cursorStyle = "bar", cursorBlink = true, rendererType = "webgl", ownsPtySize = true } = opts;
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  // Ownership can flip after mount (a mirror becomes the only visible view), so the resize closures read a ref.
  const ownsSizeRef = useRef(ownsPtySize);
  ownsSizeRef.current = ownsPtySize;

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = isDark ? TERM_DARK : TERM_LIGHT;
    }
  }, [isDark]);

  // Live-apply option changes so Settings edits reflect without recreating the PTY.
  // (rendererType is intentionally excluded — it only takes effect on new terminals.)
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontFamily;
    term.options.fontSize = fontSize;
    term.options.cursorStyle = cursorStyle;
    term.options.cursorBlink = cursorBlink;
    term.options.scrollback = scrollback;
    fitAddonRef.current?.fit();
    if (sessionId && ownsSizeRef.current) window.terminal.resize(sessionId, term.cols, term.rows);
  }, [fontFamily, fontSize, cursorStyle, cursorBlink, scrollback]);

  useEffect(() => {
    if (!containerRef.current || !sessionId || panelNumber === null) return;

    const term = new Terminal({
      theme: isDark ? TERM_DARK : TERM_LIGHT,
      fontFamily,
      fontSize,
      lineHeight: 1,
      cursorBlink,
      cursorStyle,
      allowTransparency: true,
      scrollback,
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon((_event, uri) => { window.terminal.openExternal(uri); }));
    const searchAddon = new SearchAddon();
    searchAddonRef.current = searchAddon;
    term.loadAddon(searchAddon);
    term.open(containerRef.current);

    // GPU renderer — big win on heavy output; auto-fall back to DOM on context loss.
    if (rendererType !== "dom") {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch { /* WebGL unavailable — xterm keeps its DOM renderer */ }
    }

    fitAddon.fit();
    term.focus();

    termRef.current = term;

    // Register output listener immediately — PTY starts producing output right
    // away, and the getHistory IPC roundtrip would otherwise drop zsh's startup.
    // Buffer live output during history replay, flush once xterm finishes parsing.
    const liveBuffer: string[] = [];
    let historyDone = false;

    const removeOutput = window.terminal.onOutput(sessionId, (data) => {
      if (!historyDone) {
        liveBuffer.push(data);
        return;
      }
      // Only auto-scroll if already pinned to the bottom — don't yank the user
      // up while they're reading scrollback.
      const atBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;
      term.write(data, atBottom ? () => term.scrollToBottom() : undefined);
    });

    const removeExit = window.terminal.onExit(sessionId, () => {
      term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
    });

    // Gate onData forwarding until history is fully parsed by xterm.
    // xterm.write() is async/batched — DA responses triggered by history
    // escape sequences would otherwise be sent to the new shell's stdin.
    term.onData((data) => {
      if (!historyDone) return;
      window.terminal.write(sessionId, data);
    });

    const cleanupRef = { current: () => {} };
    cleanupRef.current = () => {
      removeOutput();
      removeExit();
    };

    const flushBuffer = () => {
      historyDone = true;
      for (const chunk of liveBuffer) term.write(chunk);
      liveBuffer.length = 0;
      term.scrollToBottom();
    };

    window.terminal.getHistory(panelNumber).then((history) => {
      if (history) {
        term.write(history);
        term.write("\x18"); // CAN: cancel any partial escape sequence left by history
        term.write(
          "\r\n\x1b[90m─── restored ───────────────────────────────────\x1b[0m\r\n",
          () => {
            flushBuffer();
            // Clear any DA garbage that reached the shell before gating
            window.terminal.write(sessionId, "\x15");
          }
        );
      } else {
        flushBuffer();
      }
    });

    // rAF-coalesced: a window drag fires the observer many times/sec; do one
    // fit per frame and only round-trip to the PTY when dimensions actually change.
    let resizeRaf = 0;
    let lastCols = term.cols, lastRows = term.rows;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        const el = containerRef.current;
        if (!el?.clientWidth || !el.clientHeight) return; // collapsed box — see applyFit
        fitAddon.fit();
        if (ownsSizeRef.current && (term.cols !== lastCols || term.rows !== lastRows)) {
          lastCols = term.cols; lastRows = term.rows;
          window.terminal.resize(sessionId, term.cols, term.rows);
        }
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeObserver.disconnect();
      cleanupRef.current();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [sessionId, panelNumber]);

  const applyFit = (withFocus: boolean) => {
    if (withFocus) termRef.current?.focus();
    // No layout box (dock hidden) — fit() would clamp to xterm's 2-col minimum and mangle the PTY
    const el = containerRef.current;
    if (!el?.clientWidth || !el.clientHeight) return;
    fitAddonRef.current?.fit();
    if (termRef.current && sessionId && ownsSizeRef.current) {
      window.terminal.resize(sessionId, termRef.current.cols, termRef.current.rows);
    }
  };

  // Stable identities — consumers subscribe/search imperatively; refs hold live addon.
  const searchNext = useCallback((q: string, incremental = false) => {
    searchAddonRef.current?.findNext(q, { decorations: SEARCH_DECORATIONS, incremental });
  }, []);
  const searchPrevious = useCallback((q: string) => {
    searchAddonRef.current?.findPrevious(q, { decorations: SEARCH_DECORATIONS });
  }, []);
  const clearSearch = useCallback(() => searchAddonRef.current?.clearDecorations(), []);
  const onSearchResults = useCallback((cb: (r: SearchResults) => void) => {
    const d = searchAddonRef.current?.onDidChangeResults(cb);
    return () => d?.dispose();
  }, []);
  const focusTerminal = useCallback(() => termRef.current?.focus(), []);

  return {
    focus: () => applyFit(true),
    refit: () => applyFit(false),
    searchNext, searchPrevious, clearSearch, onSearchResults, focusTerminal,
  };
}
