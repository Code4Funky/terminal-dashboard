import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("terminal", {
  getState: (): Promise<{
    terminalCounter: number;
    lastPanels: { number: number; title: string }[];
  }> => ipcRenderer.invoke("terminal:get-state"),

  create: (
    cols: number,
    rows: number,
    panelNumber?: number,
    initialCommand?: string
  ): Promise<{ sessionId: string; number: number }> =>
    ipcRenderer.invoke("terminal:create", cols, rows, panelNumber, initialCommand),

  getHistory: (num: number): Promise<string> =>
    ipcRenderer.invoke("terminal:get-history", num),

  listHistory: (): Promise<
    { number: number; size: number; lastModified: number; title?: string }[]
  > => ipcRenderer.invoke("terminal:list-history"),

  savePanels: (panels: { number: number; title: string }[]): void =>
    ipcRenderer.send("terminal:save-panels", panels),

  write: (id: string, data: string): void =>
    ipcRenderer.send("terminal:write", id, data),

  resize: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send("terminal:resize", id, cols, rows),

  close: (id: string): void => ipcRenderer.send("terminal:close", id),

  deleteHistory: (num: number): void =>
    ipcRenderer.send("terminal:delete-history", num),

  onOutput: (id: string, cb: (data: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on(`terminal:output:${id}`, handler);
    return () => ipcRenderer.removeListener(`terminal:output:${id}`, handler);
  },

  onExit: (id: string, cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.once(`terminal:exit:${id}`, handler);
    return () => ipcRenderer.removeListener(`terminal:exit:${id}`, handler);
  },

  onNewPanel: (
    cb: (sessionId: string, number: number) => void
  ): (() => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      sessionId: string,
      number: number
    ) => cb(sessionId, number);
    ipcRenderer.on("terminal:new-panel", handler);
    return () => ipcRenderer.removeListener("terminal:new-panel", handler);
  },

  onCwdUpdate: (cb: (sessionId: string, cwd: string, gitBranch: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, sessionId: string, cwd: string, gitBranch: string) =>
      cb(sessionId, cwd, gitBranch);
    ipcRenderer.on("terminal:cwd-update", handler);
    return () => ipcRenderer.removeListener("terminal:cwd-update", handler);
  },

  setFocused: (sessionId: string): void =>
    ipcRenderer.send("terminal:set-focused", sessionId),

  getIterm2Font: (): Promise<{ family: string; size: number; files: string[] } | null> =>
    ipcRenderer.invoke("iterm2:get-font"),

  getStats: (month?: string): Promise<{
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
  }> => ipcRenderer.invoke("stats:get-data", month),

  listClaudeSessions: (): Promise<
    { filename: string; size: number; lastModified: number }[]
  > => ipcRenderer.invoke("claude:list-sessions"),

  readClaudeSession: (
    filename: string
  ): Promise<{ role: string; content: string; timestamp?: string }[]> =>
    ipcRenderer.invoke("claude:read-session", filename),

  listClaudeAgents: (): Promise<{
    name: string;
    description: string;
    model?: string;
    color?: string;
    tools: string[];
    filename: string;
  }[]> => ipcRenderer.invoke("claude:list-agents"),

  listClaudeCommands: (): Promise<{ name: string; description: string; filename: string }[]> =>
    ipcRenderer.invoke("claude:list-commands"),

  listClaudeSkills: (): Promise<{ name: string; description: string }[]> =>
    ipcRenderer.invoke("claude:list-skills"),

  listClaudeHooks: (): Promise<{ event: string; matcher?: string; command: string }[]> =>
    ipcRenderer.invoke("claude:list-hooks"),

  onClaudeConfigChanged: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("claude:config-changed", handler);
    return () => ipcRenderer.removeListener("claude:config-changed", handler);
  },

  checkWorktree: (repoName: string, branchName: string): Promise<{ exists: boolean; path: string | null }> =>
    ipcRenderer.invoke("prs:check-worktree", repoName, branchName),

  checkGitDirty: (repoName: string): Promise<{ dirty: boolean; files: string[] }> =>
    ipcRenderer.invoke("git:check-dirty", repoName),

  listLocalBranches: (): Promise<{ repo: string; branch: string; repoUrl: string }[]> =>
    ipcRenderer.invoke("prs:list-local-branches"),

  deleteBranches: (repo: string, branches: string[]): Promise<{ deleted: string[]; failed: { branch: string; reason: string }[] }> =>
    ipcRenderer.invoke("prs:delete-branch", repo, branches),

  cleanupMerged: (repo: string): Promise<{ deleted: string[]; failed: { branch: string; reason: string }[] }> =>
    ipcRenderer.invoke("prs:cleanup-merged", repo),

  listPRs: (): Promise<{
    number: number;
    title: string;
    url: string;
    headRefName: string;
    headRefOid: string;
    isDraft: boolean;
    createdAt: string;
    reviewDecision: string | null;
    repository: { name: string; nameWithOwner: string };
  }[]> => ipcRenderer.invoke("prs:list"),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("shell:open-external", url),

  listNotes: (): Promise<{ id: string; title: string; command: string; description?: string; type?: "command" | "note"; body?: string }[]> =>
    ipcRenderer.invoke("notes:list"),

  saveNote: (card: { id: string; title: string; command: string; description?: string; type?: "command" | "note"; body?: string }): void =>
    ipcRenderer.send("notes:save", card),

  deleteNote: (id: string): void =>
    ipcRenderer.send("notes:delete", id),

  listGithubRepos: (): Promise<{ name: string; branches: string[]; repoUrl: string }[]> =>
    ipcRenderer.invoke("github:list-repos"),

  getClaudeLimits: (): Promise<{
    five_hour: { utilization: number; resets_at: string | null };
    seven_day: { utilization: number; resets_at: string | null };
    extra_usage: { monthly_limit: number; used_credits: number; utilization: number } | null;
    org_id: string;
  } | null> => ipcRenderer.invoke("usage:get-limits"),

  getUsageSessions: (): Promise<{
    sessionId: string;
    totalCost: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    lastActivity: string;
    modelsUsed: string[];
    resolvedPath: string | null;
  }[]> => ipcRenderer.invoke("usage:get-sessions"),

  openClaudeFile: (filepath: string): Promise<void> =>
    ipcRenderer.invoke("claude:open-file", filepath),

  listClaudeMemoryFiles: (): Promise<{ path: string; label: string; size: number }[]> =>
    ipcRenderer.invoke("claude:list-memory-files"),

  readClaudeMemoryFile: (filepath: string): Promise<string> =>
    ipcRenderer.invoke("claude:read-memory-file", filepath),

  getClaudeActiveCount: (): Promise<number> =>
    ipcRenderer.invoke("claude:active-count"),

  writeToFocusedTerminal: (text: string): Promise<void> =>
    ipcRenderer.invoke("claude:write-to-focused", text),

  listClaudeWorktrees: (): Promise<{ repo: string; branch: string; path: string; merged: boolean }[]> =>
    ipcRenderer.invoke("claude-worktrees:list"),

  removeClaudeWorktree: (repoName: string, wtPath: string): Promise<void> =>
    ipcRenderer.invoke("claude-worktrees:remove", repoName, wtPath),

  getChatSettings: (): Promise<{ model: string; wikiDir: string }> =>
    ipcRenderer.invoke("chat:get-settings"),

  saveChatSettings: (data: { model: string; wikiDir: string }): void =>
    ipcRenderer.send("chat:save-settings", data),

  sendChatMessage: (params: { requestId: string; message: string; sessionId: string | null; mode: "kb" | "code"; wikiContext?: string; model?: string }): void =>
    ipcRenderer.send("chat:send", params),

  loadChatWikiPages: (): Promise<{ name: string; content: string }[]> =>
    ipcRenderer.invoke("chat:load-wiki-pages"),

  loadChatSessions: (): Promise<unknown[]> =>
    ipcRenderer.invoke("chat:load-sessions"),

  saveChatSessions: (data: unknown[]): void =>
    ipcRenderer.send("chat:save-sessions", data),

  stopChat: (requestId: string): void =>
    ipcRenderer.send("chat:stop", requestId),

  onChatChunk: (requestId: string, cb: (text: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, id: string, text: string) => { if (id === requestId) cb(text); };
    ipcRenderer.on("chat:chunk", handler);
    return () => ipcRenderer.removeListener("chat:chunk", handler);
  },

  onChatSessionId: (requestId: string, cb: (sessionId: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, id: string, sid: string) => { if (id === requestId) cb(sid); };
    ipcRenderer.on("chat:session-id", handler);
    return () => ipcRenderer.removeListener("chat:session-id", handler);
  },

  onChatDone: (requestId: string, cb: () => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, id: string) => { if (id === requestId) cb(); };
    ipcRenderer.on("chat:done", handler);
    return () => ipcRenderer.removeListener("chat:done", handler);
  },

  onChatError: (requestId: string, cb: (error: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, id: string, error: string) => { if (id === requestId) cb(error); };
    ipcRenderer.on("chat:error", handler);
    return () => ipcRenderer.removeListener("chat:error", handler);
  },

  onChatUsage: (requestId: string, cb: (usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, id: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }) => { if (id === requestId) cb(usage); };
    ipcRenderer.on("chat:usage", handler);
    return () => ipcRenderer.removeListener("chat:usage", handler);
  },

  onChatToolActivity: (requestId: string, cb: (toolName: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, id: string, toolName: string) => { if (id === requestId) cb(toolName); };
    ipcRenderer.on("chat:tool-activity", handler);
    return () => ipcRenderer.removeListener("chat:tool-activity", handler);
  },
});
