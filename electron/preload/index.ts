import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("terminal", {
  getState: (): Promise<{
    terminalCounter: number;
    lastPanels: { number: number; title: string }[];
  }> => ipcRenderer.invoke("terminal:get-state"),

  create: (
    cols: number,
    rows: number,
    panelNumber?: number
  ): Promise<{ sessionId: string; number: number }> =>
    ipcRenderer.invoke("terminal:create", cols, rows, panelNumber),

  getHistory: (num: number): Promise<string> =>
    ipcRenderer.invoke("terminal:get-history", num),

  listHistory: (): Promise<
    { number: number; size: number; lastModified: number }[]
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
});
