import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("terminal", {
    getState: () => ipcRenderer.invoke("terminal:get-state"),
    create: (cols, rows, panelNumber, initialCommand) => ipcRenderer.invoke("terminal:create", cols, rows, panelNumber, initialCommand),
    getHistory: (num) => ipcRenderer.invoke("terminal:get-history", num),
    listHistory: () => ipcRenderer.invoke("terminal:list-history"),
    savePanels: (panels) => ipcRenderer.send("terminal:save-panels", panels),
    write: (id, data) => ipcRenderer.send("terminal:write", id, data),
    writeToAll: (data) => ipcRenderer.send("terminal:write-broadcast", data),
    resize: (id, cols, rows) => ipcRenderer.send("terminal:resize", id, cols, rows),
    close: (id) => ipcRenderer.send("terminal:close", id),
    deleteHistory: (num) => ipcRenderer.send("terminal:delete-history", num),
    onOutput: (id, cb) => {
        const handler = (_, data) => cb(data);
        ipcRenderer.on(`terminal:output:${id}`, handler);
        return () => ipcRenderer.removeListener(`terminal:output:${id}`, handler);
    },
    onExit: (id, cb) => {
        const handler = () => cb();
        ipcRenderer.once(`terminal:exit:${id}`, handler);
        return () => ipcRenderer.removeListener(`terminal:exit:${id}`, handler);
    },
    onNewPanel: (cb) => {
        const handler = (_, sessionId, number) => cb(sessionId, number);
        ipcRenderer.on("terminal:new-panel", handler);
        return () => ipcRenderer.removeListener("terminal:new-panel", handler);
    },
    onCwdUpdate: (cb) => {
        const handler = (_, sessionId, cwd, gitBranch) => cb(sessionId, cwd, gitBranch);
        ipcRenderer.on("terminal:cwd-update", handler);
        return () => ipcRenderer.removeListener("terminal:cwd-update", handler);
    },
    setFocused: (sessionId) => ipcRenderer.send("terminal:set-focused", sessionId),
    setBackgroundColor: (color) => ipcRenderer.send("terminal:set-background-color", color),
    getIterm2Font: () => ipcRenderer.invoke("iterm2:get-font"),
    getStats: (month) => ipcRenderer.invoke("stats:get-data", month),
    listClaudeSessions: () => ipcRenderer.invoke("claude:list-sessions"),
    readClaudeSession: (filename) => ipcRenderer.invoke("claude:read-session", filename),
    listClaudeAgents: () => ipcRenderer.invoke("claude:list-agents"),
    listClaudeCommands: () => ipcRenderer.invoke("claude:list-commands"),
    listClaudeSkills: () => ipcRenderer.invoke("claude:list-skills"),
    listClaudeHooks: () => ipcRenderer.invoke("claude:list-hooks"),
    getPanelClaudeSessions: (panelNumber) => ipcRenderer.invoke("claude:get-panel-sessions", panelNumber),
    getAllPanelClaudeSessions: () => ipcRenderer.invoke("claude:get-all-panel-sessions"),
    getClaudeHookStatus: () => ipcRenderer.invoke("claude:hook-status"),
    installClaudeHook: () => ipcRenderer.invoke("claude:install-hook"),
    onClaudeSessionRecorded: (cb) => {
        const handler = (_, panelNumber, claudeSessionId) => cb(panelNumber, claudeSessionId);
        ipcRenderer.on("terminal:claude-session-recorded", handler);
        return () => ipcRenderer.removeListener("terminal:claude-session-recorded", handler);
    },
    onClaudeConfigChanged: (cb) => {
        const handler = () => cb();
        ipcRenderer.on("claude:config-changed", handler);
        return () => ipcRenderer.removeListener("claude:config-changed", handler);
    },
    checkWorktree: (repoName, branchName) => ipcRenderer.invoke("prs:check-worktree", repoName, branchName),
    checkGitDirty: (repoName) => ipcRenderer.invoke("git:check-dirty", repoName),
    listLocalBranches: () => ipcRenderer.invoke("prs:list-local-branches"),
    deleteBranches: (repo, branches) => ipcRenderer.invoke("prs:delete-branch", repo, branches),
    cleanupMerged: (repo) => ipcRenderer.invoke("prs:cleanup-merged", repo),
    listPRs: (pinnedRepoNames) => ipcRenderer.invoke("prs:list", pinnedRepoNames),
    getGhLogin: () => ipcRenderer.invoke("gh:current-user"),
    getPRDiff: (repoName, prNumber) => ipcRenderer.invoke("prs:get-diff", repoName, prNumber),
    getCIStatus: (repoNameWithOwner, prNumber) => ipcRenderer.invoke("ci:get-status", repoNameWithOwner, prNumber),
    openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
    openFolder: (repoName) => ipcRenderer.invoke("shell:open-folder", repoName),
    listDir: (repoName, subdir) => ipcRenderer.invoke("repo:list-dir", repoName, subdir),
    listFiles: (repoName) => ipcRenderer.invoke("repo:list-files", repoName),
    grepFiles: (repoName, query) => ipcRenderer.invoke("repo:grep-files", repoName, query),
    openRepoFile: (repoName, filePath) => ipcRenderer.invoke("repo:open-file", repoName, filePath),
    readRepoFile: (repoName, filePath) => ipcRenderer.invoke("repo:read-file", repoName, filePath),
    openInEditor: (repoName, filePath, editor) => ipcRenderer.invoke("repo:open-in-editor", repoName, filePath, editor),
    showInFinder: (repoName, filePath) => ipcRenderer.invoke("repo:show-in-finder", repoName, filePath),
    getRepoBranch: (repoName) => ipcRenderer.invoke("git:current-branch", repoName),
    getWorkingTree: (repoName) => ipcRenderer.invoke("git:working-tree", repoName),
    getChangeCount: (repoName) => ipcRenderer.invoke("git:change-count", repoName),
    getFileDiff: (repoName, filePath, staged) => ipcRenderer.invoke("git:file-diff", repoName, filePath, staged),
    stageFile: (repoName, filePath) => ipcRenderer.invoke("git:stage-file", repoName, filePath),
    unstageFile: (repoName, filePath) => ipcRenderer.invoke("git:unstage-file", repoName, filePath),
    stageAll: (repoName) => ipcRenderer.invoke("git:stage-all", repoName),
    unstageAll: (repoName) => ipcRenderer.invoke("git:unstage-all", repoName),
    discardUnstaged: (repoName) => ipcRenderer.invoke("git:discard-unstaged", repoName),
    gitCommit: (repoName, message) => ipcRenderer.invoke("git:commit", repoName, message),
    getCommits: (repoName, headRefName, prNumber) => ipcRenderer.invoke("git:commits", repoName, headRefName, prNumber),
    getCommitDiff: (repoName, hash) => ipcRenderer.invoke("git:commit-diff", repoName, hash),
    cloneRepository: (url, requestId) => ipcRenderer.send("git:clone", { url, requestId }),
    onCloneProgress: (requestId, cb) => {
        const handler = (_, id, text) => { if (id === requestId)
            cb(text); };
        ipcRenderer.on("git:clone-progress", handler);
        return () => ipcRenderer.removeListener("git:clone-progress", handler);
    },
    onCloneDone: (requestId, cb) => {
        const handler = (_, id, name) => { if (id === requestId)
            cb(name); };
        ipcRenderer.on("git:clone-done", handler);
        return () => ipcRenderer.removeListener("git:clone-done", handler);
    },
    onCloneError: (requestId, cb) => {
        const handler = (_, id, err) => { if (id === requestId)
            cb(err); };
        ipcRenderer.on("git:clone-error", handler);
        return () => ipcRenderer.removeListener("git:clone-error", handler);
    },
    listNotes: () => ipcRenderer.invoke("notes:list"),
    saveNote: (card) => ipcRenderer.send("notes:save", card),
    deleteNote: (id) => ipcRenderer.send("notes:delete", id),
    listGithubRepos: () => ipcRenderer.invoke("github:list-repos"),
    getClaudeLimits: () => ipcRenderer.invoke("usage:get-limits"),
    getUsageSessions: () => ipcRenderer.invoke("usage:get-sessions"),
    openClaudeFile: (filepath) => ipcRenderer.invoke("claude:open-file", filepath),
    listClaudeMemoryFiles: () => ipcRenderer.invoke("claude:list-memory-files"),
    readClaudeMemoryFile: (filepath) => ipcRenderer.invoke("claude:read-memory-file", filepath),
    getClaudeActiveCount: () => ipcRenderer.invoke("claude:active-count"),
    writeToFocusedTerminal: (text) => ipcRenderer.invoke("claude:write-to-focused", text),
    listClaudeWorktrees: () => ipcRenderer.invoke("claude-worktrees:list"),
    removeClaudeWorktree: (repoName, wtPath) => ipcRenderer.invoke("claude-worktrees:remove", repoName, wtPath),
    getChatSettings: () => ipcRenderer.invoke("chat:get-settings"),
    saveChatSettings: (data) => ipcRenderer.send("chat:save-settings", data),
    pickChatWikiDir: () => ipcRenderer.invoke("chat:pick-wiki-dir"),
    sendChatMessage: (params) => ipcRenderer.send("chat:send", params),
    loadChatWikiPages: () => ipcRenderer.invoke("chat:load-wiki-pages"),
    loadChatSessions: () => ipcRenderer.invoke("chat:load-sessions"),
    saveChatSessions: (data) => ipcRenderer.send("chat:save-sessions", data),
    stopChat: (requestId) => ipcRenderer.send("chat:stop", requestId),
    onChatChunk: (requestId, cb) => {
        const handler = (_, id, text) => { if (id === requestId)
            cb(text); };
        ipcRenderer.on("chat:chunk", handler);
        return () => ipcRenderer.removeListener("chat:chunk", handler);
    },
    onChatSessionId: (requestId, cb) => {
        const handler = (_, id, sid) => { if (id === requestId)
            cb(sid); };
        ipcRenderer.on("chat:session-id", handler);
        return () => ipcRenderer.removeListener("chat:session-id", handler);
    },
    onChatDone: (requestId, cb) => {
        const handler = (_, id) => { if (id === requestId)
            cb(); };
        ipcRenderer.on("chat:done", handler);
        return () => ipcRenderer.removeListener("chat:done", handler);
    },
    onChatError: (requestId, cb) => {
        const handler = (_, id, error) => { if (id === requestId)
            cb(error); };
        ipcRenderer.on("chat:error", handler);
        return () => ipcRenderer.removeListener("chat:error", handler);
    },
    onChatUsage: (requestId, cb) => {
        const handler = (_, id, usage) => { if (id === requestId)
            cb(usage); };
        ipcRenderer.on("chat:usage", handler);
        return () => ipcRenderer.removeListener("chat:usage", handler);
    },
    onChatToolActivity: (requestId, cb) => {
        const handler = (_, id, toolName) => { if (id === requestId)
            cb(toolName); };
        ipcRenderer.on("chat:tool-activity", handler);
        return () => ipcRenderer.removeListener("chat:tool-activity", handler);
    },
});
