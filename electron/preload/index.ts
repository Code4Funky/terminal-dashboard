import { contextBridge, ipcRenderer } from "electron";

// Mirrors src/types/tasks.ts — inlined to keep the preload off the renderer's tsconfig.
type PreloadTaskSummary = {
  claudeSessionId: string;
  panelNumber: number | null;
  cwd: string;
  source: "task-tools" | "todowrite" | "todo-file" | "manual";
  repoRoot?: string;
  updatedAt: number;
  tasks: { id: string; subject: string; status: "pending" | "in_progress" | "completed"; activeForm?: string; updatedAt: number; priority?: "high" | "medium" | "low"; due?: string; blocked?: boolean }[];
  total: number;
  completed: number;
  inProgress: number;
};

contextBridge.exposeInMainWorld("terminal", {
  getState: (): Promise<{
    terminalCounter: number;
    lastPanels: { number: number; title: string; group?: string; dir?: "row" | "column"; pinned?: boolean }[];
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

  savePanels: (panels: { number: number; title: string; group?: string; dir?: "row" | "column"; pinned?: boolean }[]): void =>
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

  setBackgroundColor: (color: string): void =>
    ipcRenderer.send("terminal:set-background-color", color),

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
      activeDays: number;
      currentStreak: number;
      longestStreak: number;
      peakHour: number | null;
      allTimeDailyCounts: Record<string, number>;
      allTimeDailyModelTokens: Record<string, Record<string, number>>;
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

  getPanelClaudeSessions: (panelNumber: number): Promise<{ claudeSessionId: string; cwd: string; startedAt: number }[]> =>
    ipcRenderer.invoke("claude:get-panel-sessions", panelNumber),

  getAllPanelClaudeSessions: (): Promise<Record<number, { claudeSessionId: string; cwd: string; startedAt: number }[]>> =>
    ipcRenderer.invoke("claude:get-all-panel-sessions"),

  getClaudeHookStatus: (): Promise<{ scriptPath: string; installed: boolean; taskScriptPath: string; taskInstalled: boolean }> =>
    ipcRenderer.invoke("claude:hook-status"),

  installClaudeHook: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("claude:install-hook"),

  getAllClaudeTasks: (): Promise<PreloadTaskSummary[]> =>
    ipcRenderer.invoke("claude:get-all-tasks"),

  getPanelTasks: (panelNumber: number): Promise<PreloadTaskSummary[]> =>
    ipcRenderer.invoke("claude:get-panel-tasks", panelNumber),

  installTaskHook: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("claude:install-task-hook"),

  addManualTask: (subject: string): Promise<PreloadTaskSummary | null> =>
    ipcRenderer.invoke("claude:add-manual-task", subject),

  toggleManualTask: (taskId: string): Promise<PreloadTaskSummary | null> =>
    ipcRenderer.invoke("claude:toggle-manual-task", taskId),

  removeManualTask: (taskId: string): Promise<PreloadTaskSummary | null> =>
    ipcRenderer.invoke("claude:remove-manual-task", taskId),

  deleteTodoFileItem: (filePath: string, index: number): Promise<boolean> =>
    ipcRenderer.invoke("claude:delete-todo-file-item", filePath, index),

  clearCompletedTodoFileItems: (filePath: string): Promise<number> =>
    ipcRenderer.invoke("claude:clear-completed-todo-file-items", filePath),

  rescanTodoFiles: (): Promise<number> =>
    ipcRenderer.invoke("claude:rescan-todo-files"),

  onClaudeSessionRecorded: (cb: (panelNumber: number, claudeSessionId: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, panelNumber: number, claudeSessionId: string) =>
      cb(panelNumber, claudeSessionId);
    ipcRenderer.on("terminal:claude-session-recorded", handler);
    return () => ipcRenderer.removeListener("terminal:claude-session-recorded", handler);
  },

  onClaudeTasksUpdated: (cb: (summary: PreloadTaskSummary) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, summary: PreloadTaskSummary) => cb(summary);
    ipcRenderer.on("terminal:claude-tasks-updated", handler);
    return () => ipcRenderer.removeListener("terminal:claude-tasks-updated", handler);
  },

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

  listPRs: (repoNames: string[]): Promise<{
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
  }[]> => ipcRenderer.invoke("prs:list", repoNames),

  getGhLogin: (): Promise<string | null> =>
    ipcRenderer.invoke("gh:current-user"),

  getMyTeams: (): Promise<string[]> =>
    ipcRenderer.invoke("gh:my-teams"),

  searchPRRefs: (view: string): Promise<{ nameWithOwner: string; number: number }[]> =>
    ipcRenderer.invoke("prs:search-refs", view),

  hydratePRs: (refs: { nameWithOwner: string; number: number }[]): Promise<any[]> =>
    ipcRenderer.invoke("prs:hydrate", refs),

  getPRDiff: (repoName: string, prNumber: number): Promise<string> =>
    ipcRenderer.invoke("prs:get-diff", repoName, prNumber),

  getCIStatus: (repoNameWithOwner: string, prNumber: number): Promise<{
    __typename: string;
    name?: string;
    context?: string;
    status: string;
    conclusion: string | null;
    startedAt: string;
    completedAt: string | null;
    url: string;
  }[]> => ipcRenderer.invoke("ci:get-status", repoNameWithOwner, prNumber),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("shell:open-external", url),

  // repoOrPath: a bare repo name (under ~/Documents/GitHub) or an absolute / ~-prefixed root
  openFolder: (repoOrPath: string): Promise<void> =>
    ipcRenderer.invoke("shell:open-folder", repoOrPath),

  listDir: (repoOrPath: string, subdir: string): Promise<{ name: string; isDir: boolean; path: string }[]> =>
    ipcRenderer.invoke("repo:list-dir", repoOrPath, subdir),

  listDirs: (path?: string, showHidden?: boolean): Promise<{ path: string; parent: string | null; home: string; entries: { name: string; path: string; count: number | null }[] }> =>
    ipcRenderer.invoke("fs:list-dirs", path, showHidden),

  getFrequentDirs: (): Promise<{ name: string }[]> =>
    ipcRenderer.invoke("fs:frequent-dirs"),

  listFiles: (repoOrPath: string): Promise<string[]> =>
    ipcRenderer.invoke("repo:list-files", repoOrPath),

  grepMatches: (repoOrPath: string, query: string, limit?: number, mode?: { caseSensitive?: boolean; regex?: boolean }): Promise<{ hits: { file: string; count: number; line: number; preview: string }[]; totalFiles: number; badPattern?: boolean; truncated?: boolean; timedOut?: boolean }> =>
    ipcRenderer.invoke("repo:grep-matches", repoOrPath, query, limit, mode),

  openRepoFile: (repoOrPath: string, filePath: string): Promise<void> =>
    ipcRenderer.invoke("repo:open-file", repoOrPath, filePath),

  readRepoFile: (repoOrPath: string, filePath: string): Promise<string | null> =>
    ipcRenderer.invoke("repo:read-file", repoOrPath, filePath),

  writeRepoFile: (repoOrPath: string, filePath: string, content: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("repo:write-file", repoOrPath, filePath, content),

  watchRepoFile: (repoOrPath: string, filePath: string): Promise<void> =>
    ipcRenderer.invoke("repo:watch-file", repoOrPath, filePath),

  unwatchRepoFile: (): Promise<void> => ipcRenderer.invoke("repo:unwatch-file"),

  onFileChanged: (cb: (repo: string, filePath: string, content: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, repo: string, filePath: string, content: string) =>
      cb(repo, filePath, content);
    ipcRenderer.on("terminal:file-changed", handler);
    return () => ipcRenderer.removeListener("terminal:file-changed", handler);
  },

  openInEditor: (repoOrPath: string, filePath: string, editor: string): Promise<void> =>
    ipcRenderer.invoke("repo:open-in-editor", repoOrPath, filePath, editor),

  showInFinder: (repoOrPath: string, filePath: string): Promise<void> =>
    ipcRenderer.invoke("repo:show-in-finder", repoOrPath, filePath),

  getRepoBranch: (repoName: string): Promise<string | null> =>
    ipcRenderer.invoke("git:current-branch", repoName),

  getWorkingTree: (repoName: string): Promise<{
    staged: { path: string; filename: string; dir: string; status: string; additions: number; deletions: number }[];
    unstaged: { path: string; filename: string; dir: string; status: string; additions: number; deletions: number }[];
  }> => ipcRenderer.invoke("git:working-tree", repoName),

  getChangeCount: (repoName: string): Promise<number> =>
    ipcRenderer.invoke("git:change-count", repoName),

  getRepoStatus: (repoOrPath: string): Promise<{ branch: string; ahead: number; behind: number; changed: number } | null> =>
    ipcRenderer.invoke("git:repo-status", repoOrPath),

  getFileDiff: (repoName: string, filePath: string, staged: boolean): Promise<string> =>
    ipcRenderer.invoke("git:file-diff", repoName, filePath, staged),

  stageFile: (repoName: string, filePath: string): Promise<void> =>
    ipcRenderer.invoke("git:stage-file", repoName, filePath),

  unstageFile: (repoName: string, filePath: string): Promise<void> =>
    ipcRenderer.invoke("git:unstage-file", repoName, filePath),

  stageAll: (repoName: string): Promise<void> =>
    ipcRenderer.invoke("git:stage-all", repoName),

  unstageAll: (repoName: string): Promise<void> =>
    ipcRenderer.invoke("git:unstage-all", repoName),

  discardUnstaged: (repoName: string): Promise<void> =>
    ipcRenderer.invoke("git:discard-unstaged", repoName),

  gitCommit: (repoName: string, message: string): Promise<void> =>
    ipcRenderer.invoke("git:commit", repoName, message),

  getCommits: (repoName: string, headRefName: string, prNumber?: number): Promise<{
    hash: string; subject: string; author: string; date: string; isMerge: boolean; additions: number; deletions: number;
  }[]> => ipcRenderer.invoke("git:commits", repoName, headRefName, prNumber),

  getCommitDiff: (repoName: string, hash: string): Promise<string> =>
    ipcRenderer.invoke("git:commit-diff", repoName, hash),

  cloneRepository: (url: string, requestId: string): void =>
    ipcRenderer.send("git:clone", { url, requestId }),

  onCloneProgress: (requestId: string, cb: (text: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, id: string, text: string) => { if (id === requestId) cb(text); };
    ipcRenderer.on("git:clone-progress", handler);
    return () => ipcRenderer.removeListener("git:clone-progress", handler);
  },

  onCloneDone: (requestId: string, cb: (repoName: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, id: string, name: string) => { if (id === requestId) cb(name); };
    ipcRenderer.on("git:clone-done", handler);
    return () => ipcRenderer.removeListener("git:clone-done", handler);
  },

  onCloneError: (requestId: string, cb: (error: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, id: string, err: string) => { if (id === requestId) cb(err); };
    ipcRenderer.on("git:clone-error", handler);
    return () => ipcRenderer.removeListener("git:clone-error", handler);
  },

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

  pickChatWikiDir: (): Promise<string | null> =>
    ipcRenderer.invoke("chat:pick-wiki-dir"),

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

  getLinearIssues: (): Promise<{
    issues: {
      id: string; identifier: string; title: string; priority: number;
      state: { name: string; type: string; color: string };
      team: { name: string }; url: string; updatedAt: string;
    }[];
    lastSyncedAt: number | null;
    error: string | null;
  }> => ipcRenderer.invoke("linear:get-issues"),

  syncLinear: (): Promise<{
    issues: {
      id: string; identifier: string; title: string; priority: number;
      state: { name: string; type: string; color: string };
      team: { name: string }; url: string; updatedAt: string;
    }[];
    lastSyncedAt: number | null;
    error: string | null;
  }> => ipcRenderer.invoke("linear:sync"),

  onLinearIssuesUpdated: (cb: (state: {
    issues: {
      id: string; identifier: string; title: string; priority: number;
      state: { name: string; type: string; color: string };
      team: { name: string }; url: string; updatedAt: string;
    }[];
    lastSyncedAt: number | null;
    error: string | null;
  }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, s: Parameters<typeof cb>[0]) => cb(s);
    ipcRenderer.on("linear:issues-updated", handler);
    return () => ipcRenderer.removeListener("linear:issues-updated", handler);
  },
});
