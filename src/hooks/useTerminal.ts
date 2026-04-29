import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

declare global {
  interface Window {
    terminal: {
      getState: () => Promise<{
        terminalCounter: number;
        lastPanels: { number: number; title: string }[];
      }>;
      create: (
        cols: number,
        rows: number,
        panelNumber?: number,
        initialCommand?: string
      ) => Promise<{ sessionId: string; number: number }>;
      getHistory: (num: number) => Promise<string>;
      listHistory: () => Promise<{ number: number; size: number; lastModified: number; title?: string }[]>;
      savePanels: (panels: { number: number; title: string }[]) => void;
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
      listPRs: () => Promise<{
        number: number;
        title: string;
        url: string;
        headRefName: string;
        headRefOid: string;
        isDraft: boolean;
        createdAt: string;
        reviewDecision: string | null;
        repository: { name: string; nameWithOwner: string };
      }[]>;
      openExternal: (url: string) => Promise<void>;
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
    };
  }
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

export function useTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  sessionId: string | null,
  panelNumber: number | null,
  fontFamily = "MesloLGS NF, Monaco, monospace",
  fontSize = 12,
  isDark = true
) {
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = isDark ? TERM_DARK : TERM_LIGHT;
    }
  }, [isDark]);

  useEffect(() => {
    if (!containerRef.current || !sessionId || panelNumber === null) return;

    const term = new Terminal({
      theme: isDark ? TERM_DARK : TERM_LIGHT,
      fontFamily,
      fontSize,
      lineHeight: 1,
      cursorBlink: true,
      cursorStyle: "bar",
      allowTransparency: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
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
      } else {
        term.write(data, () => term.scrollToBottom());
      }
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

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      window.terminal.resize(sessionId, term.cols, term.rows);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      cleanupRef.current();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, panelNumber]);

  const focus = () => termRef.current?.focus();
  return { focus };
}
