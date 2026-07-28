"use strict";
const electron = require("electron");
const path = require("path");
const http = require("http");
const child_process = require("child_process");
const util = require("util");
const fs = require("fs");
const pty = require("node-pty");
const os = require("os");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const pty__namespace = /* @__PURE__ */ _interopNamespaceDefault(pty);
const execAsync = util.promisify(child_process.exec);
const TOOL_ENV = { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin` };
electron.app.name = "Flight Deck";
function resolveCcusageEnv() {
  const nvmDir = `${os.homedir()}/.nvm/versions/node`;
  const nvmBinDirs = [];
  try {
    if (fs__namespace.existsSync(nvmDir)) {
      for (const v of fs__namespace.readdirSync(nvmDir).sort().reverse()) {
        nvmBinDirs.push(`${nvmDir}/${v}/bin`);
      }
    }
  } catch {
  }
  const extraPaths = [
    ...nvmBinDirs,
    "/usr/local/bin",
    "/opt/homebrew/bin"
  ];
  const augmentedPath = [...extraPaths, process.env.PATH ?? ""].join(":");
  const env = { ...process.env, PATH: augmentedPath };
  const candidates = [
    "ccusage",
    ...nvmBinDirs.map((d) => `${d}/ccusage`),
    "/usr/local/bin/ccusage",
    "/opt/homebrew/bin/ccusage"
  ];
  for (const c of candidates) {
    try {
      child_process.execSync(`"${c}" --version`, { stdio: "ignore", timeout: 3e3, env });
      return { bin: c, env };
    } catch {
    }
  }
  return { bin: "ccusage", env };
}
const { bin: CCUSAGE_BIN, env: CCUSAGE_ENV } = resolveCcusageEnv();
const CLAUDE_BIN = (() => {
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude"
  ];
  for (const c of candidates) {
    if (fs__namespace.existsSync(c)) return c;
  }
  return "claude";
})();
const dataDir = path.join(os.homedir(), ".terminal-dashboard");
const stateFile = path.join(dataDir, "state.json");
const historyDir = path.join(dataDir, "history");
const repoStatsFile = path.join(dataDir, "repo-stats.json");
const claudeSessionsDir = path.join(os.homedir(), ".claude", "sessions");
const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
const claudeAgentsDir = path.join(os.homedir(), ".claude", "agents");
const claudeCommandsDir = path.join(os.homedir(), ".claude", "commands");
const claudeSkillsDir = path.join(os.homedir(), ".claude", "skills");
const notesFile = path.join(dataDir, "notes.json");
const linearIssuesFile = path.join(dataDir, "linear-issues.json");
const claudeHookScript = path.join(dataDir, "claude-sessionstart-hook.sh");
const claudeTaskHookScript = path.join(dataDir, "claude-posttooluse-hook.sh");
const TASK_HOOK_MATCHER = "TodoWrite|TaskCreate|TaskUpdate|TaskList|Write|Edit|MultiEdit";
fs__namespace.mkdirSync(historyDir, { recursive: true });
function ensureClaudeHookScript() {
  const content = `#!/bin/bash
# Claude SessionStart hook — reports session ID to Flight Deck terminal-dashboard.
# Reads hook input JSON on stdin, extracts session_id, posts to the local
# dashboard server with the surrounding TERMINAL_SESSION_ID so the panel can
# remember which Claude session ran in it.
input=$(cat)
session_id=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -1)
if [ -n "$session_id" ] && [ -n "$TERMINAL_SESSION_ID" ] && [ -n "$TERMINAL_DASHBOARD_PORT" ]; then
  payload=$(printf '{"terminalSessionId":"%s","claudeSessionId":"%s","cwd":"%s"}' \\
    "$TERMINAL_SESSION_ID" "$session_id" "$PWD")
  curl -s -m 2 -X POST "http://127.0.0.1:$TERMINAL_DASHBOARD_PORT/claude-session" \\
    -H "Content-Type: application/json" -d "$payload" >/dev/null 2>&1 &
fi
exit 0
`;
  try {
    if (!fs__namespace.existsSync(claudeHookScript) || fs__namespace.readFileSync(claudeHookScript, "utf8") !== content) {
      fs__namespace.writeFileSync(claudeHookScript, content);
    }
    fs__namespace.chmodSync(claudeHookScript, 493);
  } catch (e) {
    console.error("[claude-hook] failed to write script:", e);
  }
}
function ensureClaudeTaskHookScript() {
  const content = `#!/bin/bash
# Claude PostToolUse hook — forwards the raw task payload to Flight Deck.
# Buffers stdin first, then backgrounds curl so it can't race the pipe close.
input=$(cat)
# File tools fire on every edit — only forward *todo.md writes; task-tool payloads carry no file_path.
if printf '%s' "$input" | grep -q '"file_path"'; then
  printf '%s' "$input" | grep -q 'todo\\.md' || exit 0
fi
if [ -n "$TERMINAL_SESSION_ID" ] && [ -n "$TERMINAL_DASHBOARD_PORT" ]; then
  curl -s -m 2 -X POST "http://127.0.0.1:$TERMINAL_DASHBOARD_PORT/claude-tasks" \\
    -H "Content-Type: application/json" \\
    -H "X-Terminal-Session-Id: $TERMINAL_SESSION_ID" \\
    --data-binary "$input" >/dev/null 2>&1 &
fi
exit 0
`;
  try {
    if (!fs__namespace.existsSync(claudeTaskHookScript) || fs__namespace.readFileSync(claudeTaskHookScript, "utf8") !== content) {
      fs__namespace.writeFileSync(claudeTaskHookScript, content);
    }
    fs__namespace.chmodSync(claudeTaskHookScript, 493);
  } catch (e) {
    console.error("[claude-task-hook] failed to write script:", e);
  }
}
function loadNotes() {
  try {
    return JSON.parse(fs__namespace.readFileSync(notesFile, "utf8"));
  } catch {
    return [];
  }
}
function saveNotes(notes) {
  fs__namespace.writeFileSync(notesFile, JSON.stringify(notes, null, 2));
}
function loadState() {
  try {
    const s = JSON.parse(fs__namespace.readFileSync(stateFile, "utf8"));
    return { panelTitles: {}, panelClaudeSessions: {}, claudeTaskSessions: {}, ...s };
  } catch {
    return { terminalCounter: 0, lastPanels: [], panelTitles: {}, panelClaudeSessions: {}, claudeTaskSessions: {} };
  }
}
let saveStateTimer = null;
function saveState(_state) {
  if (saveStateTimer) clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(flushState, 250);
}
function flushState() {
  if (saveStateTimer) {
    clearTimeout(saveStateTimer);
    saveStateTimer = null;
  }
  try {
    fs__namespace.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch {
  }
}
let cachedRepoStats = null;
let repoStatFlushTimer = null;
function loadRepoStats() {
  if (cachedRepoStats) return cachedRepoStats;
  try {
    cachedRepoStats = JSON.parse(fs__namespace.readFileSync(repoStatsFile, "utf8"));
  } catch {
    cachedRepoStats = {};
  }
  return cachedRepoStats;
}
const githubDir = path.join(os.homedir(), "Documents", "GitHub");
const sessionLastRepo = /* @__PURE__ */ new Map();
const sessionCwd = /* @__PURE__ */ new Map();
function recordRepoVisit(sessionId, cwd) {
  if (!cwd.startsWith(githubDir + "/")) return;
  const repoName = cwd.slice(githubDir.length + 1).split("/")[0];
  if (!repoName) return;
  if (sessionLastRepo.get(sessionId) === repoName) return;
  sessionLastRepo.set(sessionId, repoName);
  const stats = loadRepoStats();
  stats[repoName] = { visits: (stats[repoName]?.visits ?? 0) + 1, lastSeen: Date.now() };
  if (repoStatFlushTimer) clearTimeout(repoStatFlushTimer);
  repoStatFlushTimer = setTimeout(() => fs__namespace.writeFileSync(repoStatsFile, JSON.stringify(stats)), 2e3);
}
const MODEL_PRICES = {
  "claude-opus-4-6": { input: 15, cacheWrite: 18.75, cacheRead: 1.5, output: 75 },
  "claude-opus-4-5": { input: 15, cacheWrite: 18.75, cacheRead: 1.5, output: 75 },
  "claude-sonnet-4-6": { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  "claude-sonnet-4-5": { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  "claude-haiku-4-5": { input: 0.8, cacheWrite: 1, cacheRead: 0.08, output: 4 }
};
const DEFAULT_PRICE = { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 };
function modelPrice(model) {
  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    if (model.includes(key) || model === key) return price;
  }
  if (model.includes("opus")) return MODEL_PRICES["claude-opus-4-6"];
  if (model.includes("haiku")) return MODEL_PRICES["claude-haiku-4-5"];
  return DEFAULT_PRICE;
}
function calcCost(inp, cacheWrite, cacheRead, out, price) {
  return (inp * price.input + cacheWrite * price.cacheWrite + cacheRead * price.cacheRead + out * price.output) / 1e6;
}
function computeStreaks(dailyCounts) {
  const active = Object.keys(dailyCounts).filter((d) => dailyCounts[d] > 0).sort();
  if (active.length === 0) return { current: 0, longest: 0 };
  let longest = 1, run = 1;
  for (let i = 1; i < active.length; i++) {
    const diff = (new Date(active[i]).getTime() - new Date(active[i - 1]).getTime()) / 864e5;
    if (diff === 1) {
      run++;
      if (run > longest) longest = run;
    } else run = 1;
  }
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const last = active[active.length - 1];
  let current = 0;
  if (last === today || last === yesterday) {
    current = 1;
    for (let i = active.length - 2; i >= 0; i--) {
      const diff = (new Date(active[i + 1]).getTime() - new Date(active[i]).getTime()) / 864e5;
      if (diff === 1) current++;
      else break;
    }
  }
  return { current, longest };
}
function collectClaudeJsonlFiles() {
  const results = [];
  if (!fs__namespace.existsSync(claudeProjectsDir)) return results;
  for (const proj of fs__namespace.readdirSync(claudeProjectsDir)) {
    const projPath = path.join(claudeProjectsDir, proj);
    try {
      if (!fs__namespace.statSync(projPath).isDirectory()) continue;
      for (const f of fs__namespace.readdirSync(projPath)) {
        if (f.endsWith(".jsonl")) results.push({ file: path.join(projPath, f), projectDir: proj });
      }
    } catch {
    }
  }
  return results;
}
function computeClaudeStatsUncached(targetMonth) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const month = targetMonth ?? currentMonth;
  const isPastMonth = month < currentMonth;
  const daysInMonth = {};
  const dayTokensInMonth = {};
  const d0 = /* @__PURE__ */ new Date(month + "-01T00:00:00");
  const nextMonth = new Date(d0);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const lastDay = new Date(nextMonth.getTime() - 864e5).toISOString().slice(0, 10);
  const d1 = /* @__PURE__ */ new Date((isPastMonth ? lastDay : today) + "T23:59:59");
  for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    daysInMonth[key] = 0;
    dayTokensInMonth[key] = 0;
  }
  const claudeRepoVisits = {};
  const hourCounts = {};
  const allTimeDailyCounts = {};
  const allTimeDailyModelTokens = {};
  let totalSessions = 0;
  let monthSessions = /* @__PURE__ */ new Set();
  let totalMessages = 0;
  let monthMessages = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;
  let monthInputTokens = 0;
  let monthOutputTokens = 0;
  let monthCacheReadTokens = 0;
  let monthCacheCreationTokens = 0;
  const monthModelUsage = {};
  try {
    const files = collectClaudeJsonlFiles();
    totalSessions = files.length;
    for (const { file } of files) {
      const lines = fs__namespace.readFileSync(file, "utf8").split("\n");
      let fileHasMonthEntry = false;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type !== "user" && entry.type !== "assistant") continue;
          totalMessages++;
          const day = entry.timestamp ? entry.timestamp.slice(0, 10) : "";
          if (day) allTimeDailyCounts[day] = (allTimeDailyCounts[day] ?? 0) + 1;
          if (entry.timestamp) {
            const hr = new Date(entry.timestamp).getHours();
            hourCounts[hr] = (hourCounts[hr] ?? 0) + 1;
          }
          const isThisMonth = day.startsWith(month);
          if (isThisMonth) {
            monthMessages++;
            if (day in daysInMonth) daysInMonth[day]++;
            fileHasMonthEntry = true;
          }
          if (entry.type === "assistant") {
            const usage = entry.message?.usage;
            if (usage) {
              const inp = usage.input_tokens ?? 0;
              const out = usage.output_tokens ?? 0;
              const cacheRead = usage.cache_read_input_tokens ?? 0;
              const cacheCreate = usage.cache_creation_input_tokens ?? 0;
              totalInputTokens += inp;
              totalOutputTokens += out;
              totalCacheReadTokens += cacheRead;
              totalCacheCreationTokens += cacheCreate;
              const model = entry.message?.model ?? "unknown";
              if (day) {
                if (!allTimeDailyModelTokens[day]) allTimeDailyModelTokens[day] = {};
                allTimeDailyModelTokens[day][model] = (allTimeDailyModelTokens[day][model] ?? 0) + inp + out;
              }
              if (isThisMonth) {
                monthInputTokens += inp;
                monthOutputTokens += out;
                monthCacheReadTokens += cacheRead;
                monthCacheCreationTokens += cacheCreate;
                if (day in dayTokensInMonth) dayTokensInMonth[day] += inp + out;
                if (!monthModelUsage[model]) monthModelUsage[model] = { inp: 0, cacheWrite: 0, cacheRead: 0, out: 0 };
                monthModelUsage[model].inp += inp;
                monthModelUsage[model].cacheWrite += cacheCreate;
                monthModelUsage[model].cacheRead += cacheRead;
                monthModelUsage[model].out += out;
              }
            }
          }
          const cwd = entry.cwd ?? "";
          if (cwd.startsWith(githubDir + "/")) {
            const repoName = cwd.slice(githubDir.length + 1).split("/")[0];
            if (repoName) {
              const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
              if (!claudeRepoVisits[repoName]) claudeRepoVisits[repoName] = { visits: 0, lastSeen: 0 };
              claudeRepoVisits[repoName].visits++;
              if (ts > claudeRepoVisits[repoName].lastSeen) claudeRepoVisits[repoName].lastSeen = ts;
            }
          }
        } catch {
        }
      }
      if (fileHasMonthEntry) monthSessions.add(file);
    }
  } catch {
  }
  return {
    currentMonth: month,
    totalSessions,
    monthSessions: monthSessions.size,
    totalMessages,
    monthMessages,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    monthInputTokens,
    monthOutputTokens,
    monthCacheReadTokens,
    monthCacheCreationTokens,
    estimatedCost: Object.entries(monthModelUsage).reduce((sum, [model, u]) => {
      return sum + calcCost(u.inp, u.cacheWrite, u.cacheRead, u.out, modelPrice(model));
    }, 0),
    modelBreakdown: Object.entries(monthModelUsage).map(([model, u]) => {
      const p = modelPrice(model);
      return {
        model,
        cost: calcCost(u.inp, u.cacheWrite, u.cacheRead, u.out, p),
        costContent: (u.inp * p.input + u.out * p.output) / 1e6,
        costCache: (u.cacheWrite * p.cacheWrite + u.cacheRead * p.cacheRead) / 1e6,
        inputTokens: u.inp,
        outputTokens: u.out,
        cacheWriteTokens: u.cacheWrite,
        cacheReadTokens: u.cacheRead
      };
    }).sort((a, b) => b.cost - a.cost),
    dailyCounts: Object.entries(daysInMonth).map(([date, count]) => ({ date, count })),
    dailyTokens: Object.entries(dayTokensInMonth).map(([date, tokens]) => ({ date, tokens })),
    claudeRepoVisits,
    activeDays: Object.values(allTimeDailyCounts).filter((c) => c > 0).length,
    currentStreak: computeStreaks(allTimeDailyCounts).current,
    longestStreak: computeStreaks(allTimeDailyCounts).longest,
    peakHour: (() => {
      const entry = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
      return entry ? Number(entry[0]) : null;
    })(),
    allTimeDailyCounts,
    allTimeDailyModelTokens
  };
}
const statsCache = /* @__PURE__ */ new Map();
function claudeFilesSignature() {
  return collectClaudeJsonlFiles().map(({ file }) => {
    try {
      const s = fs__namespace.statSync(file);
      return `${file}:${s.mtimeMs}:${s.size}`;
    } catch {
      return file;
    }
  }).sort().join("|");
}
function computeClaudeStats(targetMonth) {
  const key = targetMonth ?? new Date(Date.now()).toISOString().slice(0, 7);
  const sig = claudeFilesSignature();
  const hit = statsCache.get(key);
  if (hit && hit.sig === sig) return hit.data;
  const data = computeClaudeStatsUncached(targetMonth);
  statsCache.set(key, { sig, data });
  return data;
}
function pruneHistory() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1e3;
  try {
    for (const f of fs__namespace.readdirSync(historyDir)) {
      const p = path.join(historyDir, f);
      if (fs__namespace.statSync(p).mtimeMs < cutoff) fs__namespace.unlinkSync(p);
    }
  } catch {
  }
}
const sessions = /* @__PURE__ */ new Map();
const sessionPanelNumbers = /* @__PURE__ */ new Map();
const oscBuffers = /* @__PURE__ */ new Map();
let mainWindow = null;
let dashboardPort = 0;
let zdotdir = "";
let focusedSessionId = null;
let state = loadState();
pruneHistory();
function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}
function historyPath(num) {
  return path.join(historyDir, `terminal-${num}.log`);
}
const pendingOutput = /* @__PURE__ */ new Map();
const outputFlushTimers = /* @__PURE__ */ new Map();
const OUTPUT_FLUSH_MS = 8;
const OUTPUT_FLUSH_BYTES = 64 * 1024;
function flushOutput(sessionId) {
  const timer = outputFlushTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    outputFlushTimers.delete(sessionId);
  }
  const data = pendingOutput.get(sessionId);
  if (data) {
    pendingOutput.delete(sessionId);
    send(`terminal:output:${sessionId}`, data);
  }
}
function queueOutput(sessionId, data) {
  const merged = (pendingOutput.get(sessionId) ?? "") + data;
  pendingOutput.set(sessionId, merged);
  if (merged.length >= OUTPUT_FLUSH_BYTES) {
    flushOutput(sessionId);
    return;
  }
  if (!outputFlushTimers.has(sessionId)) {
    outputFlushTimers.set(sessionId, setTimeout(() => flushOutput(sessionId), OUTPUT_FLUSH_MS));
  }
}
function createSession(cols, rows, panelNumber, initialCommand) {
  const num = panelNumber ?? ++state.terminalCounter;
  if (!panelNumber) flushState();
  const sessionId = crypto.randomUUID();
  const shell2 = process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "/bin/zsh");
  const ptyProcess = pty__namespace.spawn(shell2, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: os.homedir(),
    env: {
      ...process.env,
      ZDOTDIR: zdotdir || void 0,
      TERMINAL_DASHBOARD_PORT: String(dashboardPort),
      TERMINAL_SESSION_ID: sessionId
    }
  });
  const histStream = fs__namespace.createWriteStream(historyPath(num), { flags: "a" });
  oscBuffers.set(sessionId, "");
  ptyProcess.onData((rawData) => {
    const prev = oscBuffers.get(sessionId) ?? "";
    if (!prev && rawData.indexOf("\x1B]") === -1) {
      histStream.write(rawData);
      queueOutput(sessionId, rawData);
      return;
    }
    let buf = prev + rawData;
    const oscRe = /\x1b\]9999;([^\x1c]*)\x1c([^\x07]*)\x07/;
    let m;
    while ((m = oscRe.exec(buf)) !== null) {
      send("terminal:cwd-update", sessionId, m[1], m[2]);
      recordRepoVisit(sessionId, m[1]);
      if (m[1]) sessionCwd.set(sessionId, m[1]);
      buf = buf.slice(0, m.index) + buf.slice(m.index + m[0].length);
    }
    const partialIdx = buf.lastIndexOf("\x1B]9999;");
    if (partialIdx !== -1) {
      oscBuffers.set(sessionId, buf.slice(partialIdx));
      buf = buf.slice(0, partialIdx);
    } else {
      oscBuffers.set(sessionId, "");
    }
    histStream.write(buf);
    queueOutput(sessionId, buf);
  });
  ptyProcess.onExit(() => {
    flushOutput(sessionId);
    oscBuffers.delete(sessionId);
    pendingOutput.delete(sessionId);
    const timer = outputFlushTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      outputFlushTimers.delete(sessionId);
    }
    sessionLastRepo.delete(sessionId);
    sessionCwd.delete(sessionId);
    sessionPanelNumbers.delete(sessionId);
    histStream.end();
    send(`terminal:exit:${sessionId}`);
    sessions.delete(sessionId);
  });
  sessions.set(sessionId, ptyProcess);
  sessionPanelNumbers.set(sessionId, num);
  setTimeout(() => send("terminal:cwd-update", sessionId, os.homedir(), ""), 300);
  if (initialCommand) {
    setTimeout(() => ptyProcess.write(initialCommand + "\r"), 1200);
  }
  return { sessionId, number: num };
}
function coerceObj(x) {
  if (typeof x === "string") {
    try {
      return JSON.parse(x);
    } catch {
      return {};
    }
  }
  return x && typeof x === "object" ? x : {};
}
function normTaskStatus(s) {
  return s === "pending" || s === "in_progress" || s === "completed" ? s : void 0;
}
function summarizeTaskSession(s) {
  const tasks = s.order.map((id) => s.tasks[id]).filter(Boolean);
  return {
    claudeSessionId: s.claudeSessionId,
    panelNumber: s.panelNumber,
    cwd: s.cwd,
    source: s.source,
    repoRoot: s.repoRoot,
    updatedAt: s.updatedAt,
    tasks,
    total: tasks.length,
    completed: tasks.filter((t) => t.status === "completed").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length
  };
}
function upsertTask(s, id, patch) {
  const existing = s.tasks[id];
  if (existing) {
    s.tasks[id] = { ...existing, ...patch, updatedAt: Date.now() };
  } else {
    s.tasks[id] = { id, subject: patch.subject ?? "(task)", status: patch.status ?? "pending", activeForm: patch.activeForm, updatedAt: Date.now() };
    s.order.push(id);
  }
}
function pruneTaskSessions() {
  const ids = Object.keys(state.claudeTaskSessions);
  if (ids.length <= 50) return;
  const keep = new Set(
    ids.map((id) => state.claudeTaskSessions[id]).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50).map((s) => s.claudeSessionId)
  );
  for (const id of ids) {
    if (keep.has(id) || state.claudeTaskSessions[id]?.source === "manual") continue;
    delete state.claudeTaskSessions[id];
  }
}
function ingestClaudeTaskEvent(terminalSessionId, payload) {
  const toolName = payload.tool_name;
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    ingestTodoFileEvent(payload);
    return;
  }
  const claudeSessionId = payload?.session_id;
  if (typeof claudeSessionId !== "string" || !claudeSessionId) return;
  const toolInput = coerceObj(payload.tool_input);
  const result = coerceObj(payload.tool_response ?? payload.tool_output);
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  const resolvedPanel = sessionPanelNumbers.get(terminalSessionId);
  const panelNumber = resolvedPanel ?? state.claudeTaskSessions[claudeSessionId]?.panelNumber ?? null;
  let s = state.claudeTaskSessions[claudeSessionId];
  if (!s) {
    s = {
      claudeSessionId,
      panelNumber,
      cwd,
      source: toolName === "TodoWrite" ? "todowrite" : "task-tools",
      tasks: {},
      order: [],
      startedAt: Date.now(),
      updatedAt: Date.now()
    };
    state.claudeTaskSessions[claudeSessionId] = s;
  }
  if (panelNumber !== null) s.panelNumber = panelNumber;
  if (cwd) s.cwd = cwd;
  switch (toolName) {
    case "TaskCreate": {
      const created = result.task ? [result.task] : Array.isArray(result.tasks) ? result.tasks : result.id ? [result] : [];
      created.forEach((raw, i) => {
        const tk = coerceObj(raw);
        const id = String(tk.id ?? tk.taskId ?? `tc-${Date.now()}-${i}`);
        upsertTask(s, id, {
          subject: String(tk.subject ?? tk.content ?? toolInput.subject ?? "(task)"),
          status: normTaskStatus(tk.status) ?? "pending"
        });
      });
      break;
    }
    case "TaskUpdate": {
      const id = String(toolInput.taskId ?? toolInput.id ?? toolInput.task_id ?? "");
      if (!id) break;
      if (toolInput.status === "deleted") {
        if (s.tasks[id]) {
          delete s.tasks[id];
          s.order = s.order.filter((x) => x !== id);
        }
        break;
      }
      const patch = {};
      if (toolInput.subject != null) patch.subject = String(toolInput.subject);
      const st = normTaskStatus(toolInput.status);
      if (st) patch.status = st;
      upsertTask(s, id, patch);
      break;
    }
    case "TaskList": {
      const arr = Array.isArray(result) ? result : Array.isArray(result.tasks) ? result.tasks : null;
      if (!arr) break;
      s.tasks = {};
      s.order = [];
      for (const raw of arr) {
        const tk = coerceObj(raw);
        const id = String(tk.id ?? tk.taskId ?? "");
        if (!id) continue;
        s.tasks[id] = { id, subject: String(tk.subject ?? tk.content ?? "(task)"), status: normTaskStatus(tk.status) ?? "pending", updatedAt: Date.now() };
        s.order.push(id);
      }
      break;
    }
    case "TodoWrite": {
      const todos = Array.isArray(toolInput.todos) ? toolInput.todos : [];
      s.source = "todowrite";
      s.tasks = {};
      s.order = [];
      todos.forEach((raw, i) => {
        const td = coerceObj(raw);
        const id = `tw-${i}`;
        s.tasks[id] = { id, subject: String(td.content ?? td.subject ?? "(todo)"), activeForm: typeof td.activeForm === "string" ? td.activeForm : void 0, status: normTaskStatus(td.status) ?? "pending", updatedAt: Date.now() };
        s.order.push(id);
      });
      break;
    }
    default:
      return;
  }
  s.updatedAt = Date.now();
  pruneTaskSessions();
  saveState();
  send("terminal:claude-tasks-updated", summarizeTaskSession(s));
}
const TODO_ITEM_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*\S)\s*$/;
function parseTodoMarkdown(content) {
  const out = [];
  for (const line of content.split("\n")) {
    const m = TODO_ITEM_RE.exec(line);
    if (!m) continue;
    let subject = m[2];
    let priority;
    let due;
    let blocked = false;
    const pri = /^\((P[012])\)\s*/i.exec(subject);
    if (pri) {
      const p = pri[1].toUpperCase();
      priority = p === "P0" ? "high" : p === "P1" ? "medium" : "low";
      subject = subject.slice(pri[0].length);
    }
    const dueM = /@due\(([^)]*)\)/i.exec(subject);
    if (dueM) {
      due = dueM[1].trim() || void 0;
      subject = subject.replace(dueM[0], "");
    }
    const blkM = /(@blocked|\[blocked\])/i.exec(subject);
    if (blkM) {
      blocked = true;
      subject = subject.replace(blkM[0], "");
    }
    subject = subject.replace(/\s{2,}/g, " ").trim();
    out.push({ subject, status: m[1] === " " ? "pending" : "completed", priority, due, blocked: blocked || void 0 });
  }
  return out;
}
const todoFileWatchers = /* @__PURE__ */ new Map();
const todoFileDebounce = /* @__PURE__ */ new Map();
const MAX_TODO_WATCHERS = 50;
function resolveTodoPath(payload) {
  const toolInput = coerceObj(payload.tool_input);
  const raw = typeof toolInput.file_path === "string" ? toolInput.file_path : typeof toolInput.filePath === "string" ? toolInput.filePath : "";
  if (!raw) return null;
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  const abs = path.isAbsolute(raw) ? raw : cwd ? path.resolve(cwd, raw) : raw;
  if (!/todo\.md$/i.test(path.basename(abs))) return null;
  if (abs.includes("/node_modules/") || abs.includes("/.git/")) return null;
  return abs;
}
function deriveRepoRoot(absFilePath) {
  let dir = path.dirname(absFilePath);
  while (true) {
    if (fs__namespace.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(absFilePath);
    dir = parent;
  }
}
function applyTodoFile(absPath) {
  let content;
  try {
    content = fs__namespace.readFileSync(absPath, "utf8");
  } catch {
    return false;
  }
  const items = parseTodoMarkdown(content);
  if (items.length === 0) return false;
  const key = `file:${absPath}`;
  const repoRoot = deriveRepoRoot(absPath);
  let s = state.claudeTaskSessions[key];
  if (!s) {
    s = { claudeSessionId: key, panelNumber: null, cwd: absPath, source: "todo-file", repoRoot, tasks: {}, order: [], startedAt: Date.now(), updatedAt: Date.now() };
    state.claudeTaskSessions[key] = s;
  }
  s.repoRoot = repoRoot;
  s.tasks = {};
  s.order = [];
  const sess = s;
  items.forEach((it, i) => {
    const id = `f${i}`;
    sess.tasks[id] = { id, subject: it.subject, status: it.status, updatedAt: Date.now(), priority: it.priority, due: it.due, blocked: it.blocked };
    sess.order.push(id);
  });
  s.updatedAt = Date.now();
  pruneTaskSessions();
  saveState();
  send("terminal:claude-tasks-updated", summarizeTaskSession(s));
  return true;
}
function dropTodoFileGroup(absPath) {
  const key = `file:${absPath}`;
  const s = state.claudeTaskSessions[key];
  if (s) {
    s.tasks = {};
    s.order = [];
    send("terminal:claude-tasks-updated", summarizeTaskSession(s));
    delete state.claudeTaskSessions[key];
    saveState();
  }
  unwatchTodoFile(absPath);
}
function ingestTodoFileEvent(payload) {
  const absPath = resolveTodoPath(payload);
  if (!absPath) return;
  if (applyTodoFile(absPath)) watchTodoFile(absPath);
  else dropTodoFileGroup(absPath);
}
function watchTodoFile(absPath) {
  if (todoFileWatchers.has(absPath)) return;
  if (todoFileWatchers.size >= MAX_TODO_WATCHERS) {
    console.warn(`[todo-watch] cap ${MAX_TODO_WATCHERS} reached — not watching ${absPath}; hand-edits won't live-update`);
    return;
  }
  try {
    const w = fs__namespace.watch(absPath, (event) => {
      const prev = todoFileDebounce.get(absPath);
      if (prev) clearTimeout(prev);
      todoFileDebounce.set(absPath, setTimeout(() => reparseTodoFile(absPath, event), 150));
    });
    todoFileWatchers.set(absPath, w);
  } catch {
  }
}
function reparseTodoFile(absPath, event) {
  todoFileDebounce.delete(absPath);
  if (!fs__namespace.existsSync(absPath)) {
    dropTodoFileGroup(absPath);
    return;
  }
  if (!applyTodoFile(absPath)) {
    dropTodoFileGroup(absPath);
    return;
  }
  if (event === "rename") {
    unwatchTodoFile(absPath);
    watchTodoFile(absPath);
  }
}
function unwatchTodoFile(absPath) {
  const w = todoFileWatchers.get(absPath);
  if (w) {
    try {
      w.close();
    } catch {
    }
    todoFileWatchers.delete(absPath);
  }
  const t = todoFileDebounce.get(absPath);
  if (t) {
    clearTimeout(t);
    todoFileDebounce.delete(absPath);
  }
}
function restoreTodoFileGroups() {
  for (const key of Object.keys(state.claudeTaskSessions)) {
    if (state.claudeTaskSessions[key]?.source !== "todo-file") continue;
    const absPath = key.startsWith("file:") ? key.slice(5) : state.claudeTaskSessions[key].cwd;
    if (applyTodoFile(absPath)) watchTodoFile(absPath);
    else dropTodoFileGroup(absPath);
  }
}
const SCAN_SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "build", "dist", "out", ".next", "target", "venv", ".venv", "vendor", ".cache", "coverage", "Pods"]);
const SCAN_MAX_DEPTH = 5;
const SCAN_MAX_DIRS = 4e3;
const SCAN_MAX_FILES = 200;
async function findTodoFiles(roots) {
  const found = /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Set();
  const queue = [];
  const enqueue = (p, depth) => {
    let real;
    try {
      real = fs__namespace.realpathSync(p);
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    queue.push({ dir: real, depth });
  };
  for (const r of roots) enqueue(r, 0);
  let budget = SCAN_MAX_DIRS;
  while (queue.length && budget > 0 && found.size < SCAN_MAX_FILES) {
    const { dir, depth } = queue.shift();
    budget--;
    let entries;
    try {
      entries = await fs__namespace.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (depth >= SCAN_MAX_DEPTH || e.name.startsWith(".") || SCAN_SKIP_DIRS.has(e.name)) continue;
        enqueue(path.join(dir, e.name), depth + 1);
      } else if (/^todo\.md$/i.test(e.name)) {
        found.add(path.join(dir, e.name));
      }
    }
  }
  return [...found];
}
async function scanTodoFiles() {
  const roots = [githubDir, ...new Set([...sessionCwd.values()].filter(Boolean))];
  const files = await findTodoFiles(roots);
  let applied = 0;
  for (const abs of files) {
    if (applyTodoFile(abs)) {
      watchTodoFile(abs);
      applied++;
    }
  }
  return applied;
}
function startHttpServer() {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/new-terminal") {
      const { sessionId, number } = createSession(220, 50);
      state.lastPanels.push({ number, title: `terminal ${number}` });
      saveState();
      send("terminal:new-panel", sessionId, number);
      res.writeHead(200);
      res.end(sessionId);
    } else if (req.method === "POST" && req.url === "/update-cwd") {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        try {
          const { sessionId, cwd, gitBranch } = JSON.parse(body);
          send("terminal:cwd-update", sessionId, cwd, gitBranch ?? "");
        } catch {
        }
        res.writeHead(200);
        res.end();
      });
    } else if (req.method === "POST" && req.url === "/claude-session") {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        try {
          const { terminalSessionId, claudeSessionId, cwd } = JSON.parse(body);
          const panelNumber = sessionPanelNumbers.get(terminalSessionId);
          if (panelNumber !== void 0 && typeof claudeSessionId === "string" && claudeSessionId) {
            const list = state.panelClaudeSessions[panelNumber] ?? [];
            if (!list.some((e) => e.claudeSessionId === claudeSessionId)) {
              list.push({ claudeSessionId, cwd: typeof cwd === "string" ? cwd : "", startedAt: Date.now() });
              state.panelClaudeSessions[panelNumber] = list.slice(-20);
              saveState(state);
              send("terminal:claude-session-recorded", panelNumber, claudeSessionId);
            }
          }
        } catch {
        }
        res.writeHead(200);
        res.end();
      });
    } else if (req.method === "POST" && req.url === "/claude-tasks") {
      const tsid = String(req.headers["x-terminal-session-id"] ?? "");
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        try {
          ingestClaudeTaskEvent(tsid, JSON.parse(body));
        } catch {
        }
        res.writeHead(200);
        res.end();
      });
    } else if (req.method === "POST" && req.url === "/cd") {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        try {
          const { cwd } = JSON.parse(body);
          const target = focusedSessionId ?? [...sessions.keys()].at(-1);
          if (target && cwd) {
            sessions.get(target)?.write(`cd ${JSON.stringify(cwd)}\r`);
          }
        } catch {
        }
        res.writeHead(200);
        res.end();
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1", () => {
    dashboardPort = server.address().port;
    fs__namespace.writeFileSync(path.join(dataDir, "port"), String(dashboardPort));
    setupZdotdir();
    createWindow();
  });
}
function setupZdotdir() {
  zdotdir = fs__namespace.mkdtempSync(path.join(os.tmpdir(), "terminal-dashboard-"));
  const scriptPath = path.join(zdotdir, "new-terminal");
  fs__namespace.writeFileSync(
    scriptPath,
    `#!/bin/zsh
curl -s -X POST "http://127.0.0.1:$TERMINAL_DASHBOARD_PORT/new-terminal" > /dev/null
`
  );
  fs__namespace.chmodSync(scriptPath, 493);
  fs__namespace.writeFileSync(
    path.join(zdotdir, ".zshrc"),
    `
# Per-session compdump to avoid locking conflicts across panels
export ZSH_COMPDUMP="/tmp/.zcompdump-\${TERMINAL_SESSION_ID}"

# Stub out uninstalled version managers to prevent command-not-found errors
command -v rbenv  &>/dev/null || rbenv()  { : }
command -v pyenv  &>/dev/null || pyenv()  { : }
command -v nodenv &>/dev/null || nodenv() { : }
command -v nvm    &>/dev/null || nvm()    { : }

# Ensure history is shared with other sessions
export HISTFILE="$HOME/.zsh_history"
export HISTSIZE=50000
export SAVEHIST=50000

# Unset ZDOTDIR before sourcing so child shells don't inherit the temp dir
unset ZDOTDIR
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"

# Prepend ~/.local/bin (after sourcing so it wins); guarded to avoid duplicate PATH entries
[[ ":$PATH:" != *":$HOME/.local/bin:"* ]] && export PATH="$HOME/.local/bin:$PATH"

# Force-load zsh-autosuggestions if not already active (in case .zshrc failed to load it)
(( ! \${+functions[_zsh_autosuggest_start]} )) &&   [[ -f /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]] &&   source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh

# Disable async mode (can cause issues in pty environments) and set visible color
ZSH_AUTOSUGGEST_USE_ASYNC=0
ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=#5c6773"

_td_new_panel() {
  curl -s -X POST "http://127.0.0.1:$TERMINAL_DASHBOARD_PORT/new-terminal" > /dev/null
  echo "\\033[32m[dashboard] new panel opened\\033[0m"
}
alias new_terminal=_td_new_panel
alias nt=_td_new_panel

export TERMINAL="${scriptPath}"

open() {
  local joined="\${*}"
  if [[ "$joined" =~ "-a (Terminal|iTerm|iTerm2|Hyper|Warp|Alacritty)" ]]; then
    _td_new_panel
  else
    command open "$@"
  fi
}

# Friendly exit message
exit() {
  echo "\\033[36mBye! 👋\\033[0m"
  builtin exit "$@"
}

# Report CWD + git branch via OSC escape sequence (real-time, no curl needed)
_td_update_cwd() {
  local _git_branch=""
  _git_branch=$(git symbolic-ref --short HEAD 2>/dev/null)
  printf "\\033]9999;%s\\034%s\\007" "$PWD" "$_git_branch"
}
precmd_functions+=(_td_update_cwd)
chpwd_functions+=(_td_update_cwd)

# cd <partial-name> → fuzzy-match ~/Documents/GitHub/*
cd() {
  local github_dir="$HOME/Documents/GitHub"
  if [[ $# -eq 1 && "$1" != /* && "$1" != ~* && "$1" != .* && "$1" != - ]]; then
    local matches=("$github_dir"/*"$1"*(N/) "$github_dir"/"$1"*(N/))
    if [[ \${#matches[@]} -gt 0 ]]; then
      builtin cd "\${matches[1]}"
      return
    fi
  fi
  builtin cd "$@"
}
`
  );
}
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#00000000",
    transparent: true,
    vibrancy: "under-window",
    visualEffectState: "active",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../out/renderer/index.html"));
  }
}
electron.app.setAboutPanelOptions({
  applicationName: "Flight Deck",
  applicationVersion: "0.1.0",
  copyright: "© 2026 Tung Tran <tranthaitung.inbox@gmail.com>",
  iconPath: path.join(__dirname, "../../build/icons/icon.icns")
});
electron.app.whenReady().then(() => {
  ensureClaudeHookScript();
  ensureClaudeTaskHookScript();
  startHttpServer();
  restoreTodoFileGroups();
  scanTodoFiles().catch((e) => console.error("[todo-scan] startup scan failed:", e));
  syncLinear();
  setInterval(() => syncLinear(), FOUR_HOURS_MS);
  let claudeConfigTimer = null;
  const notifyClaudeConfigChanged = () => {
    if (claudeConfigTimer) clearTimeout(claudeConfigTimer);
    claudeConfigTimer = setTimeout(() => send("claude:config-changed"), 300);
  };
  for (const dir of [claudeAgentsDir, claudeCommandsDir, claudeSkillsDir]) {
    try {
      fs__namespace.mkdirSync(dir, { recursive: true });
      fs__namespace.watch(dir, notifyClaudeConfigChanged);
    } catch {
    }
  }
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      setupZdotdir();
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  sessions.forEach((p) => p.kill());
  sessions.clear();
  if (process.platform !== "darwin") {
    if (zdotdir) fs__namespace.rmSync(zdotdir, { recursive: true, force: true });
    electron.app.quit();
  }
  mainWindow = null;
});
electron.app.on("before-quit", () => {
  for (const w of todoFileWatchers.values()) {
    try {
      w.close();
    } catch {
    }
  }
  flushState();
  if (zdotdir) fs__namespace.rmSync(zdotdir, { recursive: true, force: true });
});
electron.ipcMain.handle("terminal:get-state", () => state);
electron.ipcMain.handle(
  "terminal:create",
  (_, cols, rows, panelNumber, initialCommand) => {
    return createSession(cols, rows, panelNumber, initialCommand);
  }
);
electron.ipcMain.handle("terminal:get-history", (_, num) => {
  const file = historyPath(num);
  if (!fs__namespace.existsSync(file)) return "";
  const stat = fs__namespace.statSync(file);
  const readSize = Math.min(stat.size, 200 * 1024);
  const buf = Buffer.alloc(readSize);
  const fd = fs__namespace.openSync(file, "r");
  fs__namespace.readSync(fd, buf, 0, readSize, stat.size - readSize);
  fs__namespace.closeSync(fd);
  return buf.toString();
});
electron.ipcMain.on(
  "terminal:save-panels",
  (_, panels) => {
    state.lastPanels = panels;
    for (const p of panels) {
      if (p.title && p.title !== `terminal ${p.number}`) {
        state.panelTitles[p.number] = p.title;
      }
    }
    saveState();
  }
);
electron.ipcMain.handle("terminal:list-history", () => {
  try {
    return fs__namespace.readdirSync(historyDir).filter((f) => f.startsWith("terminal-") && f.endsWith(".log")).map((f) => {
      const num = parseInt(f.replace("terminal-", "").replace(".log", ""));
      const stat = fs__namespace.statSync(path.join(historyDir, f));
      return { number: num, size: stat.size, lastModified: stat.mtimeMs, title: state.panelTitles[num] };
    }).sort((a, b) => b.number - a.number);
  } catch {
    return [];
  }
});
electron.ipcMain.on("terminal:write", (_, id, data) => {
  sessions.get(id)?.write(data);
});
electron.ipcMain.on("terminal:write-broadcast", (_, data) => {
  for (const s of sessions.values()) s.write(data);
});
electron.ipcMain.on("terminal:resize", (_, id, cols, rows) => {
  sessions.get(id)?.resize(cols, rows);
});
electron.ipcMain.on("terminal:close", (_, id) => {
  sessions.get(id)?.kill();
  sessions.delete(id);
});
electron.ipcMain.on("terminal:delete-history", (_, num) => {
  try {
    fs__namespace.unlinkSync(historyPath(num));
  } catch {
  }
  let changed = false;
  if (state.panelClaudeSessions[num]) {
    delete state.panelClaudeSessions[num];
    changed = true;
  }
  for (const [sid, s] of Object.entries(state.claudeTaskSessions ?? {})) {
    if (s.panelNumber === num) {
      delete state.claudeTaskSessions[sid];
      changed = true;
    }
  }
  if (changed) saveState();
});
electron.ipcMain.on("terminal:set-focused", (_, sessionId) => {
  focusedSessionId = sessionId;
});
electron.ipcMain.on("terminal:set-background-color", (_, color) => {
  mainWindow?.setBackgroundColor(color);
});
electron.ipcMain.handle("notes:list", () => loadNotes());
electron.ipcMain.on("notes:save", (_, card) => {
  const notes = loadNotes();
  const idx = notes.findIndex((n) => n.id === card.id);
  if (idx >= 0) notes[idx] = card;
  else notes.push(card);
  saveNotes(notes);
});
electron.ipcMain.on("notes:delete", (_, id) => {
  saveNotes(loadNotes().filter((n) => n.id !== id));
});
electron.ipcMain.handle("stats:get-data", (_, month) => {
  const { claudeRepoVisits, ...claude } = computeClaudeStats(month);
  const terminalRepoMap = loadRepoStats();
  const merged = {};
  for (const [name, s] of Object.entries(terminalRepoMap)) {
    merged[name] = { visits: s.visits, lastSeen: s.lastSeen };
  }
  for (const [name, s] of Object.entries(claudeRepoVisits)) {
    if (merged[name]) {
      merged[name].visits += s.visits;
      if (s.lastSeen > merged[name].lastSeen) merged[name].lastSeen = s.lastSeen;
    } else {
      merged[name] = { ...s };
    }
  }
  const repos = Object.entries(merged).map(([name, s]) => ({ name, visits: s.visits, lastSeen: s.lastSeen })).sort((a, b) => b.visits - a.visits).slice(0, 12);
  return { claude, repos };
});
function resolveProjectPath(sessionId) {
  if (!sessionId.startsWith("-")) return null;
  function dfs(remaining, current) {
    if (remaining.length === 0) return fs__namespace.existsSync(current) ? current : null;
    const dashIdx = remaining.indexOf("-");
    if (dashIdx === -1) {
      const full = current + remaining;
      return fs__namespace.existsSync(full) ? full : null;
    }
    const prefix = remaining.slice(0, dashIdx);
    const rest = remaining.slice(dashIdx + 1);
    if (prefix.length > 0) {
      const asDir = current + prefix;
      if (fs__namespace.existsSync(asDir) && fs__namespace.statSync(asDir).isDirectory()) {
        const r = dfs(rest, asDir + "/");
        if (r !== null) return r;
      }
    }
    return dfs(rest, current + prefix + "-");
  }
  return dfs(sessionId.slice(1), "/");
}
electron.ipcMain.handle("usage:get-sessions", async () => {
  try {
    const { stdout } = await execAsync(`"${CCUSAGE_BIN}" session --json`, { timeout: 1e4, env: CCUSAGE_ENV });
    const data = JSON.parse(stdout);
    const raw = data.sessions ?? data;
    return raw.map((s) => ({ ...s, resolvedPath: resolveProjectPath(s.sessionId) })).sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  } catch {
    return [];
  }
});
const CLAUDE_LIMITS_PY = `
import subprocess, sqlite3, os, tempfile, shutil, json, urllib.request, urllib.error
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

key_str = subprocess.check_output(
    ["security","find-generic-password","-s","Claude Safe Storage","-w"],
    stderr=subprocess.DEVNULL).strip()
kdf = PBKDF2HMAC(algorithm=hashes.SHA1(),length=16,salt=b'saltysalt',iterations=1003,backend=default_backend())
aes_key = kdf.derive(key_str)
iv = b' ' * 16

def decrypt(enc):
    ct = enc[3:]
    d = Cipher(algorithms.AES(aes_key), modes.CBC(iv)).decryptor()
    raw = d.update(ct) + d.finalize()
    payload = raw[32:]; pad = payload[-1]
    return (payload[:-pad] if 0 < pad <= 16 else payload).decode('utf-8')

src = os.path.expanduser("~/Library/Application Support/Claude/Cookies")
tmp = tempfile.mktemp(suffix=".db")
shutil.copy2(src, tmp)
conn = sqlite3.connect(tmp)
rows = conn.execute("SELECT name,encrypted_value FROM cookies WHERE host_key LIKE '%claude.ai%' AND name IN ('sessionKey','lastActiveOrg','cf_clearance','__ssid','anthropic-device-id','routingHint')").fetchall()
conn.close(); os.unlink(tmp)

cookies = {}
for name, enc in rows:
    try: cookies[name] = decrypt(enc)
    except: pass

org_id = cookies.get('lastActiveOrg','')
cookie_str = "; ".join(f"{k}={v}" for k,v in cookies.items())
headers = {
    "Cookie": cookie_str, "Accept": "application/json",
    "Referer": "https://claude.ai/settings/limits",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "anthropic-client-platform": "web_claude_ai",
    "sec-fetch-site": "same-origin",
}

req = urllib.request.Request(f"https://claude.ai/api/organizations/{org_id}/usage", headers=headers)
with urllib.request.urlopen(req, timeout=10) as r:
    data = json.loads(r.read())
    data['org_id'] = org_id
    print(json.dumps(data))
`;
const PYTHON3_PATH = (() => {
  for (const p of ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]) {
    if (fs__namespace.existsSync(p)) return p;
  }
  return "python3";
})();
electron.ipcMain.handle("usage:get-limits", async () => {
  try {
    const pyPath = path.join(os.tmpdir(), "td_claude_limits.py");
    fs__namespace.writeFileSync(pyPath, CLAUDE_LIMITS_PY);
    const { stdout } = await execAsync(`"${PYTHON3_PATH}" "${pyPath}"`, { timeout: 15e3 });
    try {
      fs__namespace.unlinkSync(pyPath);
    } catch {
    }
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
});
electron.ipcMain.handle("iterm2:get-font", () => {
  try {
    const plistPath = path.join(os.homedir(), "Library/Preferences/com.googlecode.iterm2.plist");
    const tmpPath = path.join(os.tmpdir(), "td_iterm2_font.plist");
    child_process.execSync(`plutil -convert xml1 -o "${tmpPath}" "${plistPath}"`);
    const pyScript = path.join(os.tmpdir(), "td_iterm2_font.py");
    fs__namespace.writeFileSync(pyScript, [
      `import plistlib`,
      `with open(${JSON.stringify(tmpPath)}, 'rb') as f:`,
      `    data = plistlib.load(f)`,
      `profiles = data.get('New Bookmarks', [])`,
      `print(profiles[0].get('Normal Font', '') if profiles else '')`
    ].join("\n"));
    const fontStr = child_process.execSync(`python3 ${pyScript}`, { timeout: 5e3 }).toString().trim();
    try {
      fs__namespace.unlinkSync(tmpPath);
    } catch {
    }
    try {
      fs__namespace.unlinkSync(pyScript);
    } catch {
    }
    if (!fontStr) return null;
    const lastSpace = fontStr.lastIndexOf(" ");
    const postScriptName = fontStr.slice(0, lastSpace);
    const size = parseInt(fontStr.slice(lastSpace + 1), 10);
    const fcLines = child_process.execSync(`fc-list --format="%{postscriptname}	%{family}	%{file}
"`, { timeout: 5e3 }).toString().split("\n");
    const match = fcLines.find((l) => l.startsWith(postScriptName + "	"));
    if (!match) return null;
    const [, family] = match.split("	");
    return { family, size: isNaN(size) ? 12 : size, files: [] };
  } catch {
    return null;
  }
});
electron.ipcMain.handle("claude:list-sessions", () => {
  try {
    if (!fs__namespace.existsSync(claudeSessionsDir)) return [];
    return fs__namespace.readdirSync(claudeSessionsDir).filter((f) => f.endsWith(".jsonl")).map((f) => {
      const stat = fs__namespace.statSync(path.join(claudeSessionsDir, f));
      return { filename: f, size: stat.size, lastModified: stat.mtimeMs };
    }).sort((a, b) => b.lastModified - a.lastModified);
  } catch {
    return [];
  }
});
electron.ipcMain.handle("claude:list-agents", () => {
  try {
    if (!fs__namespace.existsSync(claudeAgentsDir)) return [];
    return fs__namespace.readdirSync(claudeAgentsDir).filter((f) => f.endsWith(".md")).map((f) => {
      const content = fs__namespace.readFileSync(path.join(claudeAgentsDir, f), "utf8");
      const fm = content.match(/^---\n([\s\S]*?)\n---/);
      let name = f.replace(".md", "");
      let description = "";
      let model;
      let color;
      const tools = [];
      if (fm) {
        const yaml = fm[1];
        const nameM = yaml.match(/^name:\s*(.+)$/m);
        if (nameM) name = nameM[1].trim();
        description = parseFmDescription(yaml);
        const modelM = yaml.match(/^model:\s*(.+)$/m);
        if (modelM) model = modelM[1].trim();
        const colorM = yaml.match(/^color:\s*(.+)$/m);
        if (colorM) color = colorM[1].trim();
        const toolsBlock = yaml.match(/^tools:\n((?:[ \t]+-[^\n]*\n?)*)/m);
        if (toolsBlock) {
          toolsBlock[1].split("\n").forEach((l) => {
            const m = l.match(/^\s+-\s+(.+)$/);
            if (m) tools.push(m[1].trim());
          });
        }
      }
      return { name, description, model, color, tools, filename: f };
    }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
});
function parseFmDescription(yaml) {
  const m = yaml.match(/^description:\s*(.*)/m);
  if (!m) return "";
  const inline = m[1].trim();
  if (inline && inline !== ">" && inline !== "|") return inline;
  const afterKey = yaml.slice(yaml.indexOf(m[0]) + m[0].length);
  const lines = afterKey.split("\n");
  const indented = [];
  for (const line of lines) {
    if (line === "") {
      indented.push("");
      continue;
    }
    if (/^\s+/.test(line)) indented.push(line.trim());
    else break;
  }
  return indented.join(" ").replace(/\s+/g, " ").trim();
}
electron.ipcMain.handle("claude:list-commands", () => {
  try {
    if (!fs__namespace.existsSync(claudeCommandsDir)) return [];
    return fs__namespace.readdirSync(claudeCommandsDir).filter((f) => f.endsWith(".md")).map((f) => {
      const content = fs__namespace.readFileSync(path.join(claudeCommandsDir, f), "utf8");
      const fm = content.match(/^---\n([\s\S]*?)\n---/);
      let description = "";
      if (fm) {
        description = parseFmDescription(fm[1]);
      }
      if (!description) {
        const body = fm ? content.slice(content.indexOf("---", 3) + 3) : content;
        description = body.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").trim() ?? "";
      }
      return { name: f.replace(".md", ""), description, filename: f };
    }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
});
electron.ipcMain.handle("claude:list-skills", () => {
  try {
    if (!fs__namespace.existsSync(claudeSkillsDir)) return [];
    return fs__namespace.readdirSync(claudeSkillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
      const skillFile = path.join(claudeSkillsDir, d.name, "SKILL.md");
      let description = "";
      try {
        const content = fs__namespace.readFileSync(skillFile, "utf8");
        const fm = content.match(/^---\n([\s\S]*?)\n---/);
        if (fm) {
          description = parseFmDescription(fm[1]);
        }
        if (!description) {
          const body = fm ? content.slice(content.indexOf("---", 3) + 3) : content;
          description = body.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").trim() ?? "";
        }
      } catch {
      }
      return { name: d.name, description };
    }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
});
electron.ipcMain.handle("claude:get-panel-sessions", (_, panelNumber) => {
  return state.panelClaudeSessions[panelNumber] ?? [];
});
electron.ipcMain.handle("claude:get-all-panel-sessions", () => {
  return state.panelClaudeSessions ?? {};
});
electron.ipcMain.handle("claude:hook-status", () => {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  let installed = false;
  let taskInstalled = false;
  try {
    const settings = JSON.parse(fs__namespace.readFileSync(settingsPath, "utf8"));
    for (const entry of settings.hooks?.SessionStart ?? []) {
      for (const h of entry.hooks ?? []) {
        if (h.command && h.command.includes("claude-sessionstart-hook.sh")) {
          installed = true;
        }
      }
    }
    for (const entry of settings.hooks?.PostToolUse ?? []) {
      const hasScript = (entry.hooks ?? []).some((h) => h.command?.includes("claude-posttooluse-hook.sh"));
      if (hasScript && entry.matcher === TASK_HOOK_MATCHER) taskInstalled = true;
    }
  } catch {
  }
  return { scriptPath: claudeHookScript, installed, taskScriptPath: claudeTaskHookScript, taskInstalled };
});
electron.ipcMain.handle("claude:install-hook", () => {
  try {
    ensureClaudeHookScript();
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    let settings = {};
    try {
      settings = JSON.parse(fs__namespace.readFileSync(settingsPath, "utf8"));
    } catch {
    }
    settings.hooks = settings.hooks ?? {};
    settings.hooks.SessionStart = settings.hooks.SessionStart ?? [];
    const already = settings.hooks.SessionStart.some(
      (e) => (e.hooks ?? []).some((h) => h.command?.includes("claude-sessionstart-hook.sh"))
    );
    if (!already) {
      settings.hooks.SessionStart.push({
        hooks: [{ type: "command", command: claudeHookScript }]
      });
      try {
        fs__namespace.copyFileSync(settingsPath, settingsPath + ".bak");
      } catch {
      }
      fs__namespace.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});
electron.ipcMain.handle("claude:install-task-hook", () => {
  try {
    ensureClaudeTaskHookScript();
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    let settings = {};
    try {
      settings = JSON.parse(fs__namespace.readFileSync(settingsPath, "utf8"));
    } catch {
    }
    settings.hooks = settings.hooks ?? {};
    settings.hooks.PostToolUse = settings.hooks.PostToolUse ?? [];
    const ours = settings.hooks.PostToolUse.find(
      (e) => (e.hooks ?? []).some((h) => h.command?.includes("claude-posttooluse-hook.sh"))
    );
    let changed = false;
    if (!ours) {
      settings.hooks.PostToolUse.push({
        matcher: TASK_HOOK_MATCHER,
        hooks: [{ type: "command", command: claudeTaskHookScript }]
      });
      changed = true;
    } else if (ours.matcher !== TASK_HOOK_MATCHER) {
      ours.matcher = TASK_HOOK_MATCHER;
      changed = true;
    }
    if (changed) {
      try {
        fs__namespace.copyFileSync(settingsPath, settingsPath + ".bak");
      } catch {
      }
      fs__namespace.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});
electron.ipcMain.handle("claude:get-all-tasks", () => {
  return Object.values(state.claudeTaskSessions ?? {}).map(summarizeTaskSession);
});
electron.ipcMain.handle("claude:get-panel-tasks", (_, panelNumber) => {
  return Object.values(state.claudeTaskSessions ?? {}).filter((s) => s.panelNumber === panelNumber).map(summarizeTaskSession);
});
const MANUAL_KEY = "manual:global";
function manualGroup(create) {
  let s = state.claudeTaskSessions[MANUAL_KEY];
  if (!s && create) {
    s = { claudeSessionId: MANUAL_KEY, panelNumber: null, cwd: "", source: "manual", tasks: {}, order: [], startedAt: Date.now(), updatedAt: Date.now() };
    state.claudeTaskSessions[MANUAL_KEY] = s;
  }
  return s;
}
electron.ipcMain.handle("claude:add-manual-task", (_, subject) => {
  const text = String(subject ?? "").trim();
  if (!text) return null;
  const s = manualGroup(true);
  const id = `mt-${Date.now()}`;
  s.tasks[id] = { id, subject: text, status: "pending", updatedAt: Date.now() };
  s.order.push(id);
  s.updatedAt = Date.now();
  saveState();
  const summary = summarizeTaskSession(s);
  send("terminal:claude-tasks-updated", summary);
  return summary;
});
electron.ipcMain.handle("claude:toggle-manual-task", (_, taskId) => {
  const s = manualGroup(false);
  const t = s?.tasks[taskId];
  if (!s || !t) return null;
  t.status = t.status === "completed" ? "pending" : "completed";
  t.updatedAt = Date.now();
  s.updatedAt = Date.now();
  saveState();
  const summary = summarizeTaskSession(s);
  send("terminal:claude-tasks-updated", summary);
  return summary;
});
electron.ipcMain.handle("claude:remove-manual-task", (_, taskId) => {
  const s = manualGroup(false);
  if (!s || !s.tasks[taskId]) return null;
  delete s.tasks[taskId];
  s.order = s.order.filter((x) => x !== taskId);
  s.updatedAt = Date.now();
  saveState();
  const summary = summarizeTaskSession(s);
  send("terminal:claude-tasks-updated", summary);
  return summary;
});
electron.ipcMain.handle("claude:delete-todo-file-item", (_, filePath, index) => {
  try {
    const lines = fs__namespace.readFileSync(filePath, "utf8").split("\n");
    let seen = -1, target = -1;
    for (let i = 0; i < lines.length; i++) {
      if (TODO_ITEM_RE.test(lines[i]) && ++seen === index) {
        target = i;
        break;
      }
    }
    if (target === -1) return false;
    lines.splice(target, 1);
    fs__namespace.writeFileSync(filePath, lines.join("\n"));
    if (!applyTodoFile(filePath)) dropTodoFileGroup(filePath);
    return true;
  } catch (e) {
    console.error("[todo-delete] failed:", e);
    return false;
  }
});
electron.ipcMain.handle("claude:rescan-todo-files", async () => {
  try {
    return await scanTodoFiles();
  } catch (e) {
    console.error("[todo-scan] rescan failed:", e);
    return 0;
  }
});
electron.ipcMain.handle("claude:list-hooks", () => {
  try {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    const settings = JSON.parse(fs__namespace.readFileSync(settingsPath, "utf8"));
    const result = [];
    for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
      for (const entry of entries) {
        for (const h of entry.hooks ?? []) {
          if (h.command) result.push({ event, matcher: entry.matcher, command: h.command });
        }
      }
    }
    return result;
  } catch {
    return [];
  }
});
function loadLinearIssues() {
  try {
    return JSON.parse(fs__namespace.readFileSync(linearIssuesFile, "utf8"));
  } catch {
    return { issues: [], lastSyncedAt: null, error: null };
  }
}
function saveLinearIssues(s) {
  fs__namespace.writeFileSync(linearIssuesFile, JSON.stringify(s));
}
let _claudeBin = null;
function resolveClaudeBin() {
  if (_claudeBin) return _claudeBin;
  const candidates = [
    `${os.homedir()}/.local/bin/claude`,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude"
  ];
  for (const p of candidates) {
    if (fs__namespace.existsSync(p)) {
      _claudeBin = p;
      return p;
    }
  }
  try {
    _claudeBin = child_process.execSync("zsh -lc 'which claude'", { encoding: "utf8", timeout: 5e3 }).trim();
    return _claudeBin;
  } catch {
    return "claude";
  }
}
const SYNC_ABORTED = "__sync_aborted__";
function fetchLinearViaClaude() {
  return new Promise((resolve2, reject) => {
    const proc = child_process.spawn(resolveClaudeBin(), [
      "-p",
      'Use Linear to list all issues assigned to me. Exclude completed and cancelled. Return ONLY a raw JSON array — no markdown fences, no explanation. Each element: {"id":"...","identifier":"...","title":"...","priority":0,"state":{"name":"...","type":"...","color":"..."},"team":{"name":"..."},"url":"...","updatedAt":"..."}',
      // Pre-approve Linear MCP tools: headless `claude -p` can't answer permission prompts,
      // so an unlisted tool call is blocked and it returns prose instead of the JSON array.
      "--allowedTools",
      "mcp__claude_ai_Linear,mcp__claude_ai_Linear__list_issues,mcp__linear,mcp__linear__list_issues"
    ], { env: TOOL_ENV, timeout: 3e5, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      console.error("[linear-sync]", chunk.toString());
    });
    proc.on("close", (code, signal) => {
      if (code === 143 || code === null || signal) {
        reject(new Error(SYNC_ABORTED));
        return;
      }
      if (code !== 0) {
        reject(new Error(`claude exited ${code}`));
        return;
      }
      const m = stdout.match(/\[[\s\S]*\]/);
      if (!m) {
        reject(new Error("No JSON array in claude output"));
        return;
      }
      try {
        resolve2(JSON.parse(m[0]));
      } catch (e) {
        reject(e);
      }
    });
    proc.on("error", reject);
  });
}
async function syncLinear() {
  try {
    const issues = await fetchLinearViaClaude();
    const s = { issues, lastSyncedAt: Date.now(), error: null };
    saveLinearIssues(s);
    send("linear:issues-updated", s);
    return s;
  } catch (e) {
    const current = loadLinearIssues();
    if (e instanceof Error && e.message === SYNC_ABORTED) return current;
    const s = { ...current, error: e instanceof Error ? e.message : String(e) };
    saveLinearIssues(s);
    send("linear:issues-updated", s);
    return s;
  }
}
const FOUR_HOURS_MS = 4 * 60 * 60 * 1e3;
electron.ipcMain.handle("linear:get-issues", () => loadLinearIssues());
electron.ipcMain.handle("linear:sync", async () => syncLinear());
electron.ipcMain.handle("prs:delete-branch", async (_, repo, branches) => {
  const repoPath = path.join(githubDir, repo);
  const deleted = [];
  const failed = [];
  for (const branch of branches) {
    try {
      await execAsync(`git branch -D "${branch}"`, { cwd: repoPath, env: TOOL_ENV });
      deleted.push(branch);
    } catch (e) {
      failed.push({ branch, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { deleted, failed };
});
electron.ipcMain.handle("prs:cleanup-merged", async (_, repo) => {
  const repoPath = path.join(githubDir, repo);
  const skipBranches = /* @__PURE__ */ new Set(["main", "master", "develop", "dev", "HEAD"]);
  const deleted = [];
  const failed = [];
  try {
    let defaultRef = "";
    for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
      try {
        await execAsync(`git rev-parse --verify "${candidate}"`, { cwd: repoPath, env: TOOL_ENV });
        defaultRef = candidate;
        break;
      } catch {
      }
    }
    if (!defaultRef) return { deleted: [], failed: [{ branch: "", reason: "Could not determine default branch" }] };
    const { stdout } = await execAsync(`git branch --merged "${defaultRef}"`, { cwd: repoPath, env: TOOL_ENV });
    const merged = stdout.split("\n").map((b) => b.trim().replace(/^\*\s*/, "")).filter((b) => b && !skipBranches.has(b));
    for (const branch of merged) {
      try {
        await execAsync(`git branch -d "${branch}"`, { cwd: repoPath, env: TOOL_ENV });
        deleted.push(branch);
      } catch (e) {
        failed.push({ branch, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch {
  }
  return { deleted, failed };
});
electron.ipcMain.handle("prs:list-local-branches", async () => {
  const results = [];
  const skipBranches = /* @__PURE__ */ new Set(["HEAD"]);
  try {
    for (const dir of fs__namespace.readdirSync(githubDir)) {
      const repoPath = path.join(githubDir, dir);
      try {
        if (!fs__namespace.statSync(repoPath).isDirectory()) continue;
        const gitEntry = path.join(repoPath, ".git");
        if (!fs__namespace.existsSync(gitEntry)) continue;
        if (!fs__namespace.statSync(gitEntry).isDirectory()) continue;
        const [branchOut, remoteBranchOut, remoteOut] = await Promise.all([
          execAsync(`git branch --format="%(refname:short)"`, { cwd: repoPath, env: TOOL_ENV }),
          execAsync(`git branch -r --format="%(refname:short)"`, { cwd: repoPath, env: TOOL_ENV }).catch(() => ({ stdout: "" })),
          execAsync(`git remote get-url origin`, { cwd: repoPath, env: TOOL_ENV }).catch(() => ({ stdout: "" }))
        ]);
        const rawUrl = remoteOut.stdout.trim();
        const match = rawUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
        const repoUrl = match ? `https://github.com/${match[1]}` : "";
        const seen = /* @__PURE__ */ new Set();
        for (const b of branchOut.stdout.trim().split("\n")) {
          const branch = b.trim();
          if (branch && !skipBranches.has(branch)) {
            seen.add(branch);
            results.push({ repo: dir, branch, repoUrl });
          }
        }
        for (const b of remoteBranchOut.stdout.trim().split("\n")) {
          const branch = b.trim().replace(/^origin\//, "");
          if (branch && branch !== "HEAD" && !skipBranches.has(branch) && !seen.has(branch)) {
            results.push({ repo: dir, branch, repoUrl });
          }
        }
      } catch {
      }
    }
  } catch {
  }
  return results;
});
electron.ipcMain.handle("prs:check-worktree", async (_, repoName, branchName) => {
  try {
    const repoPath = path.join(os.homedir(), "Documents", "GitHub", repoName);
    const { stdout } = await execAsync("git worktree list", { cwd: repoPath });
    for (const line of stdout.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3 && parts[2] === `[${branchName}]`) {
        return { exists: true, path: parts[0] };
      }
    }
    return { exists: false, path: null };
  } catch {
    return { exists: false, path: null };
  }
});
electron.ipcMain.handle("claude-worktrees:list", async () => {
  const results = [];
  try {
    for (const dir of fs__namespace.readdirSync(githubDir)) {
      const repoPath = path.join(githubDir, dir);
      try {
        if (!fs__namespace.statSync(repoPath).isDirectory()) continue;
        const gitEntry = path.join(repoPath, ".git");
        if (!fs__namespace.existsSync(gitEntry) || !fs__namespace.statSync(gitEntry).isDirectory()) continue;
        const { stdout } = await execAsync("git worktree list", { cwd: repoPath, env: TOOL_ENV });
        for (const line of stdout.split("\n")) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 3) continue;
          const [wtPath, , branchRef] = parts;
          if (!wtPath.includes(`${dir}-worktrees`)) continue;
          const branch = branchRef.replace(/^\[|\]$/g, "");
          let merged = false;
          try {
            await execAsync(`git merge-base --is-ancestor "${branch}" main`, { cwd: repoPath, env: TOOL_ENV });
            merged = true;
          } catch {
            try {
              await execAsync(`git merge-base --is-ancestor "${branch}" master`, { cwd: repoPath, env: TOOL_ENV });
              merged = true;
            } catch {
            }
          }
          results.push({ repo: dir, branch, path: wtPath, merged });
        }
      } catch {
      }
    }
  } catch {
  }
  return results;
});
electron.ipcMain.handle("claude-worktrees:remove", async (_, repoName, wtPath) => {
  const repoPath = path.join(githubDir, repoName);
  try {
    await execAsync(`git worktree remove --force "${wtPath}"`, { cwd: repoPath, env: TOOL_ENV });
  } catch {
    try {
      fs__namespace.rmSync(wtPath, { recursive: true, force: true });
    } catch {
    }
  }
});
electron.ipcMain.handle("git:check-dirty", async (_, repoName) => {
  try {
    const repoPath = path.join(os.homedir(), "Documents", "GitHub", repoName);
    const { stdout } = await execAsync("git status --porcelain", { cwd: repoPath });
    const files = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    return { dirty: files.length > 0, files };
  } catch {
    return { dirty: false, files: [] };
  }
});
electron.ipcMain.handle("gh:current-user", async () => {
  try {
    const { stdout } = await execAsync("gh api user --jq .login", { env: TOOL_ENV, timeout: 8e3 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
});
electron.ipcMain.handle("prs:list", async (_, pinnedRepoNames) => {
  try {
    if (!pinnedRepoNames || pinnedRepoNames.length === 0) return [];
    const repoInfos = [];
    for (const name of pinnedRepoNames) {
      const repoPath = path.join(githubDir, name);
      try {
        if (!fs__namespace.existsSync(path.join(repoPath, ".git"))) continue;
        const { stdout } = await execAsync("git remote get-url origin", { cwd: repoPath, env: TOOL_ENV }).catch(() => ({ stdout: "" }));
        const match = stdout.trim().match(/github\.com[/:](.+?)(?:\.git)?$/);
        if (match) repoInfos.push({ name, nameWithOwner: match[1] });
      } catch {
        continue;
      }
    }
    const results = await Promise.all(
      repoInfos.map(
        ({ name, nameWithOwner }) => execAsync(
          `gh pr list --repo "${nameWithOwner}" --state open --json number,title,url,headRefName,headRefOid,isDraft,createdAt,updatedAt,reviewDecision,author,additions,deletions`,
          { env: TOOL_ENV, timeout: 2e4 }
        ).then(({ stdout }) => {
          const prs = JSON.parse(stdout);
          return prs.map((pr) => ({ ...pr, repository: { name, nameWithOwner } }));
        }).catch(() => [])
      )
    );
    return results.flat();
  } catch {
    return [];
  }
});
electron.ipcMain.handle("prs:get-diff", async (_, repoName, prNumber) => {
  const repoPath = path.join(githubDir, repoName);
  try {
    const { stdout } = await execAsync(`gh pr diff ${prNumber}`, { cwd: repoPath, env: TOOL_ENV });
    return stdout;
  } catch {
    return "";
  }
});
electron.ipcMain.handle("ci:get-status", async (_, repoNameWithOwner, prNumber) => {
  try {
    const { stdout } = await execAsync(
      `gh pr view ${prNumber} --repo "${repoNameWithOwner}" --json statusCheckRollup`,
      { env: TOOL_ENV, timeout: 15e3 }
    );
    return JSON.parse(stdout).statusCheckRollup ?? [];
  } catch {
    return [];
  }
});
electron.ipcMain.handle("shell:open-external", (_, url) => {
  electron.shell.openExternal(url);
});
electron.ipcMain.handle("shell:open-folder", (_, repoName) => {
  electron.shell.openPath(path.join(githubDir, repoName));
});
const TREE_HIDDEN = /* @__PURE__ */ new Set(["node_modules", "out", "build", "dist", ".gradle", ".cache", ".next", ".nuxt", "__pycache__", ".turbo", ".DS_Store"]);
electron.ipcMain.handle("repo:list-dir", async (_, repoName, subdir) => {
  try {
    const base = path.join(githubDir, repoName, subdir);
    const entries = await fs__namespace.promises.readdir(base, { withFileTypes: true });
    return entries.filter((e) => e.name !== ".git" && !TREE_HIDDEN.has(e.name)).map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      path: subdir ? `${subdir}/${e.name}` : e.name
    })).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
});
function entryIsDir(dir, e) {
  if (e.isDirectory()) return true;
  if (e.isSymbolicLink()) {
    try {
      return fs__namespace.statSync(path.join(dir, e.name)).isDirectory();
    } catch {
      return false;
    }
  }
  return false;
}
electron.ipcMain.handle("fs:list-dirs", async (_, inputPath, showHidden) => {
  const home = os.homedir();
  let dir = inputPath && inputPath.length ? inputPath : home;
  if (dir.startsWith("~")) dir = path.join(home, dir.slice(1));
  dir = path.join(dir);
  const parent = dir === "/" ? null : path.dirname(dir);
  try {
    const raw = await fs__namespace.promises.readdir(dir, { withFileTypes: true });
    const entries = raw.filter((e) => entryIsDir(dir, e) && (showHidden || !e.name.startsWith("."))).map((e) => ({ name: e.name, path: path.join(dir, e.name) })).sort((a, b) => a.name.localeCompare(b.name, void 0, { sensitivity: "base" }));
    return { path: dir, parent, home, entries };
  } catch {
    return { path: dir, parent, home, entries: [] };
  }
});
async function walkDir(dir, base, results = []) {
  let entries;
  try {
    entries = await fs__namespace.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const e of entries) {
    if (e.name === ".git" || TREE_HIDDEN.has(e.name)) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) await walkDir(path.join(dir, e.name), rel, results);
    else results.push(rel);
  }
  return results;
}
electron.ipcMain.handle("repo:list-files", async (_, repoName) => {
  try {
    return await walkDir(path.join(githubDir, repoName), "");
  } catch {
    return [];
  }
});
electron.ipcMain.handle("repo:grep-files", async (_, repoName, query) => {
  try {
    const repoPath = path.join(githubDir, repoName);
    const excludes = [".git", ...TREE_HIDDEN].map((d) => `--exclude-dir=${d}`).join(" ");
    const { stdout } = await execAsync(`grep -ril ${excludes} ${JSON.stringify(query)} .`, { cwd: repoPath, env: TOOL_ENV });
    return stdout.trim().split("\n").map((f) => f.replace(/^\.\//, "")).filter(Boolean);
  } catch {
    return [];
  }
});
electron.ipcMain.handle("repo:open-file", (_, repoName, filePath) => {
  electron.shell.openPath(path.join(githubDir, repoName, filePath));
});
electron.ipcMain.handle("repo:read-file", async (_, repoName, filePath) => {
  try {
    return fs__namespace.readFileSync(path.join(githubDir, repoName, filePath), "utf8");
  } catch {
    return "";
  }
});
electron.ipcMain.handle("repo:open-in-editor", (_, repoName, filePath, editor) => {
  const fullPath = path.join(githubDir, repoName, filePath);
  const appName = editor === "cursor" ? "Cursor" : "Visual Studio Code";
  const proc = child_process.spawn("/usr/bin/open", ["-a", appName, fullPath]);
  proc.on("error", (e) => console.error("[open-in-editor] spawn error:", e));
  proc.on("close", (code) => {
    if (code !== 0) console.error("[open-in-editor] exit", code);
  });
  proc.unref();
});
electron.ipcMain.handle("repo:show-in-finder", (_, repoName, filePath) => {
  electron.shell.showItemInFolder(path.join(githubDir, repoName, filePath));
});
electron.ipcMain.handle("git:current-branch", async (_, repoName) => {
  try {
    const repoPath = path.join(githubDir, repoName);
    const { stdout } = await execAsync("git branch --show-current", { cwd: repoPath, env: TOOL_ENV });
    return stdout.trim() || null;
  } catch {
    return null;
  }
});
electron.ipcMain.on("git:clone", (event, { url, requestId }) => {
  const repoName = url.replace(/\.git$/, "").split("/").pop() ?? "repo";
  const destPath = path.join(githubDir, repoName);
  if (fs__namespace.existsSync(path.join(destPath, ".git"))) {
    event.sender.send("git:clone-done", requestId, repoName);
    return;
  }
  const proc = child_process.spawn("git", ["clone", "--progress", url, destPath], { env: TOOL_ENV });
  proc.stderr.on("data", (chunk) => {
    event.sender.send("git:clone-progress", requestId, chunk.toString());
  });
  proc.stdout.on("data", (chunk) => {
    event.sender.send("git:clone-progress", requestId, chunk.toString());
  });
  proc.on("close", (code) => {
    if (code === 0) {
      event.sender.send("git:clone-done", requestId, repoName);
    } else {
      event.sender.send("git:clone-error", requestId, `git clone exited with code ${code}`);
    }
  });
  proc.on("error", (err) => {
    event.sender.send("git:clone-error", requestId, err.message);
  });
});
electron.ipcMain.handle("git:working-tree", async (_, repoName) => {
  const repoPath = path.join(githubDir, repoName);
  try {
    const [statusRes, stagedNumRes, unstagedNumRes] = await Promise.all([
      execAsync("git status --porcelain", { cwd: repoPath, env: TOOL_ENV }),
      execAsync("git diff --numstat --cached", { cwd: repoPath, env: TOOL_ENV }).catch(() => ({ stdout: "" })),
      execAsync("git diff --numstat", { cwd: repoPath, env: TOOL_ENV }).catch(() => ({ stdout: "" }))
    ]);
    const parseNumstat = (raw) => {
      const m = /* @__PURE__ */ new Map();
      for (const line of raw.trim().split("\n")) {
        const parts = line.split("	");
        if (parts.length < 3) continue;
        const a = parseInt(parts[0]);
        const d = parseInt(parts[1]);
        if (!isNaN(a) && !isNaN(d)) m.set(parts[2].trim(), { additions: a, deletions: d });
      }
      return m;
    };
    const stagedNums = parseNumstat(stagedNumRes.stdout);
    const unstagedNums = parseNumstat(unstagedNumRes.stdout);
    const makeFile = (path2, status, nums) => {
      const segs = path2.split("/");
      const filename = segs.pop() ?? path2;
      const dir = segs.join("/");
      return { path: path2, filename, dir, status, ...nums };
    };
    const staged = [], unstaged = [];
    for (const line of statusRes.stdout.split("\n")) {
      if (line.length < 3) continue;
      const x = line[0], y = line[1];
      const filePath = line.slice(3).trim();
      if (!filePath) continue;
      if (x !== " " && x !== "?") staged.push(makeFile(filePath, x, stagedNums.get(filePath) ?? { additions: 0, deletions: 0 }));
      if (y === "?") unstaged.push(makeFile(filePath, "?", { additions: 0, deletions: 0 }));
      else if (y !== " ") unstaged.push(makeFile(filePath, y, unstagedNums.get(filePath) ?? { additions: 0, deletions: 0 }));
    }
    return { staged, unstaged };
  } catch {
    return { staged: [], unstaged: [] };
  }
});
electron.ipcMain.handle("git:change-count", async (_, repoName) => {
  try {
    const { stdout } = await execAsync("git status --porcelain", { cwd: path.join(githubDir, repoName), env: TOOL_ENV });
    return stdout.trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
});
electron.ipcMain.handle("git:file-diff", async (_, repoName, filePath, staged) => {
  try {
    const { stdout } = await execAsync(
      `git diff ${staged ? "--cached" : ""} -- "${filePath}"`,
      { cwd: path.join(githubDir, repoName), env: TOOL_ENV }
    );
    return stdout;
  } catch {
    return "";
  }
});
electron.ipcMain.handle("git:stage-file", async (_, repoName, filePath) => {
  await execAsync(`git add -- "${filePath}"`, { cwd: path.join(githubDir, repoName), env: TOOL_ENV });
});
electron.ipcMain.handle("git:unstage-file", async (_, repoName, filePath) => {
  await execAsync(`git restore --staged -- "${filePath}"`, { cwd: path.join(githubDir, repoName), env: TOOL_ENV });
});
electron.ipcMain.handle("git:stage-all", async (_, repoName) => {
  await execAsync("git add -A", { cwd: path.join(githubDir, repoName), env: TOOL_ENV });
});
electron.ipcMain.handle("git:unstage-all", async (_, repoName) => {
  await execAsync("git restore --staged .", { cwd: path.join(githubDir, repoName), env: TOOL_ENV });
});
electron.ipcMain.handle("git:discard-unstaged", async (_, repoName) => {
  await execAsync("git restore .", { cwd: path.join(githubDir, repoName), env: TOOL_ENV }).catch(() => {
  });
});
electron.ipcMain.handle("git:commit", async (_, repoName, message) => {
  await execAsync(`git commit -m ${JSON.stringify(message)}`, { cwd: path.join(githubDir, repoName), env: TOOL_ENV });
});
electron.ipcMain.handle("git:commits", async (_, repoName, headRefName, prNumber) => {
  const repoPath = path.join(githubDir, repoName);
  const localStats = async (hash) => {
    try {
      const { stdout } = await execAsync(`git show --numstat --format="" ${hash}`, { cwd: repoPath, env: TOOL_ENV });
      let additions = 0, deletions = 0;
      for (const line of stdout.trim().split("\n")) {
        const cols = line.split("	");
        if (cols.length < 2) continue;
        const a = parseInt(cols[0]), d = parseInt(cols[1]);
        if (!isNaN(a)) additions += a;
        if (!isNaN(d)) deletions += d;
      }
      return { additions, deletions };
    } catch {
      return { additions: 0, deletions: 0 };
    }
  };
  if (!prNumber && headRefName) {
    try {
      const { stdout } = await execAsync(
        `gh pr list --head "${headRefName}" --json number --jq '.[0].number'`,
        { cwd: repoPath, env: TOOL_ENV }
      );
      const n = parseInt(stdout.trim(), 10);
      if (!isNaN(n)) prNumber = n;
    } catch {
    }
  }
  if (prNumber) {
    try {
      const { stdout } = await execAsync(
        `gh pr view ${prNumber} --json commits --jq '.commits[] | [.oid, .messageHeadline, (.authors[0].name // ""), .committedDate[0:10], (if (.parents | length) > 1 then "merge" else "" end)] | join("|||")'`,
        { cwd: repoPath, env: TOOL_ENV }
      );
      const commits = [];
      for (const line of stdout.trim().split("\n").filter(Boolean)) {
        const parts = line.split("|||");
        if (parts.length < 4) continue;
        const [hash, subject, author, date, mergeFlag = ""] = parts;
        const isMerge = mergeFlag === "merge";
        const stats = await localStats(hash.trim());
        commits.push({ hash: hash.trim(), subject: subject.trim(), author: author.trim(), date: date.trim(), isMerge, isLocal: false, ...stats });
      }
      if (commits.length > 0) return commits;
    } catch {
    }
  }
  try {
    await execAsync(`git fetch origin ${headRefName}`, { cwd: repoPath, env: TOOL_ENV }).catch(() => {
    });
    let base = "origin/main";
    try {
      const { stdout: symRef } = await execAsync(`git symbolic-ref refs/remotes/origin/HEAD`, { cwd: repoPath, env: TOOL_ENV });
      base = symRef.trim().replace("refs/remotes/", "");
    } catch {
      for (const candidate of ["origin/main", "origin/master"]) {
        try {
          await execAsync(`git rev-parse ${candidate}`, { cwd: repoPath, env: TOOL_ENV });
          base = candidate;
          break;
        } catch {
        }
      }
    }
    const defaultBranchName = base.replace("origin/", "");
    const isDefaultBranch = headRefName === defaultBranchName;
    const range = isDefaultBranch ? `-50 ${headRefName}` : `${base}..${headRefName}`;
    const SEP = "|||GS|||";
    let rawOut = "";
    const { stdout } = await execAsync(
      `git log --numstat --pretty=tformat:"${SEP}%H|||%s|||%an|||%ad|||%P" --date=short ${range}`,
      { cwd: repoPath, env: TOOL_ENV }
    );
    rawOut = stdout;
    const pushedHashes = /* @__PURE__ */ new Set();
    try {
      const { stdout: pushed } = await execAsync(`git log origin/${headRefName} --format=%H`, { cwd: repoPath, env: TOOL_ENV });
      for (const h of pushed.trim().split("\n").filter(Boolean)) pushedHashes.add(h.trim());
    } catch {
    }
    const commits = [];
    for (const chunk of rawOut.split(SEP).filter(Boolean)) {
      const lines = chunk.trim().split("\n");
      const parts = lines[0].split("|||");
      if (parts.length < 4) continue;
      const [hash, subject, author, date, parents = ""] = parts;
      const isMerge = parents.trim().split(/\s+/).filter(Boolean).length > 1;
      let additions = 0, deletions = 0;
      for (const line of lines.slice(1)) {
        const cols = line.split("	");
        if (cols.length < 2) continue;
        const a = parseInt(cols[0]), d = parseInt(cols[1]);
        if (!isNaN(a) && !isNaN(d)) {
          additions += a;
          deletions += d;
        }
      }
      commits.push({ hash: hash.trim(), subject: subject.trim(), author: author.trim(), date: date.trim(), isMerge, additions, deletions, isLocal: !pushedHashes.has(hash.trim()) });
    }
    return commits;
  } catch {
    return [];
  }
});
electron.ipcMain.handle("git:commit-diff", async (_, repoName, hash) => {
  try {
    const { stdout } = await execAsync(`git show ${hash}`, { cwd: path.join(githubDir, repoName), env: TOOL_ENV });
    return stdout;
  } catch {
    return "";
  }
});
electron.ipcMain.handle("github:list-repos", async () => {
  const results = [];
  const targetBranches = ["main", "dev", "master", "develop"];
  try {
    for (const dir of fs__namespace.readdirSync(githubDir)) {
      const repoPath = path.join(githubDir, dir);
      try {
        if (!fs__namespace.statSync(repoPath).isDirectory()) continue;
        const gitEntry = path.join(repoPath, ".git");
        if (!fs__namespace.existsSync(gitEntry)) continue;
        if (!fs__namespace.statSync(gitEntry).isDirectory()) continue;
        const [branchOut, remoteOut] = await Promise.all([
          execAsync(`git branch --format="%(refname:short)"`, { cwd: repoPath, env: TOOL_ENV }),
          execAsync(`git remote get-url origin`, { cwd: repoPath, env: TOOL_ENV }).catch(() => ({ stdout: "" }))
        ]);
        const existing = new Set(branchOut.stdout.trim().split("\n").map((b) => b.trim()));
        const branches = targetBranches.filter((b) => existing.has(b));
        if (branches.length === 0) continue;
        const rawUrl = remoteOut.stdout.trim();
        const match = rawUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
        const repoUrl = match ? `https://github.com/${match[1]}` : "";
        results.push({ name: dir, branches, repoUrl });
      } catch {
      }
    }
  } catch {
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
});
electron.ipcMain.handle("claude:open-file", (_, filepath) => {
  const resolved = filepath.startsWith("~") ? path.join(os.homedir(), filepath.slice(1)) : filepath;
  electron.shell.openPath(resolved);
});
electron.ipcMain.handle("claude:list-memory-files", () => {
  const files = [];
  const globalMem = path.join(os.homedir(), ".claude", "MEMORY.md");
  if (fs__namespace.existsSync(globalMem)) {
    files.push({ path: globalMem, label: "MEMORY.md (global)", size: fs__namespace.statSync(globalMem).size });
  }
  if (fs__namespace.existsSync(claudeProjectsDir)) {
    try {
      for (const proj of fs__namespace.readdirSync(claudeProjectsDir)) {
        const memDir = path.join(claudeProjectsDir, proj, "memory");
        try {
          if (!fs__namespace.existsSync(memDir) || !fs__namespace.statSync(memDir).isDirectory()) continue;
          for (const f of fs__namespace.readdirSync(memDir)) {
            if (!f.endsWith(".md")) continue;
            const fullPath = path.join(memDir, f);
            files.push({ path: fullPath, label: `${proj.slice(0, 40)}/${f}`, size: fs__namespace.statSync(fullPath).size });
          }
        } catch {
        }
      }
    } catch {
    }
  }
  return files;
});
electron.ipcMain.handle("claude:read-memory-file", (_, filepath) => {
  try {
    return fs__namespace.readFileSync(filepath, "utf8");
  } catch {
    return "";
  }
});
electron.ipcMain.handle("claude:active-count", async () => {
  try {
    const { stdout } = await execAsync("pgrep -x claude", { timeout: 2e3 });
    return stdout.trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
});
electron.ipcMain.handle("claude:write-to-focused", (_, text) => {
  if (focusedSessionId) sessions.get(focusedSessionId)?.write(text);
});
function stripCorrectionBlock(text) {
  return text.replace(/^─+[^\n]*\n\*{3}[^*\n]*\*{3}\n─+[^\n]*\n*/, "").trimStart();
}
const chatSessionsFile = path.join(dataDir, "chat-sessions.json");
const chatSettingsFile = path.join(dataDir, "chat-settings.json");
const chatProcesses = /* @__PURE__ */ new Map();
const DEFAULT_WIKI_DIR = "~/Documents/GitHub/knowledge-base/wiki";
function loadChatSettings() {
  try {
    const s = JSON.parse(fs__namespace.readFileSync(chatSettingsFile, "utf8"));
    return { model: "claude-sonnet-4-6", wikiDir: DEFAULT_WIKI_DIR, ...s };
  } catch {
    return { model: "claude-sonnet-4-6", wikiDir: DEFAULT_WIKI_DIR };
  }
}
electron.ipcMain.handle("chat:get-settings", () => loadChatSettings());
electron.ipcMain.on("chat:save-settings", (_, data) => {
  try {
    fs__namespace.writeFileSync(chatSettingsFile, JSON.stringify(data, null, 2));
  } catch {
  }
});
electron.ipcMain.handle("chat:pick-wiki-dir", async () => {
  const win = electron.BrowserWindow.getFocusedWindow();
  const result = await electron.dialog.showOpenDialog(win ?? electron.BrowserWindow.getAllWindows()[0], {
    title: "Choose wiki directory",
    properties: ["openDirectory"]
  });
  return result.canceled ? null : result.filePaths[0];
});
electron.ipcMain.handle("chat:load-wiki-pages", () => {
  const raw = loadChatSettings().wikiDir;
  const wikiDir = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
  if (!fs__namespace.existsSync(wikiDir)) return [];
  try {
    return fs__namespace.readdirSync(wikiDir).filter((f) => f.endsWith(".md") || f.endsWith(".excalidraw")).sort().map((f) => {
      const content = fs__namespace.readFileSync(path.join(wikiDir, f), "utf8");
      if (f.endsWith(".excalidraw")) {
        return {
          name: f.replace(".excalidraw", "") + " (Excalidraw diagram)",
          content: `[Excalidraw diagram — to display it, output the full JSON below wrapped in a \`\`\`excalidraw fenced code block]
${content}`
        };
      }
      return { name: f.replace(".md", ""), content };
    });
  } catch {
    return [];
  }
});
electron.ipcMain.handle("chat:load-sessions", () => {
  try {
    return JSON.parse(fs__namespace.readFileSync(chatSessionsFile, "utf8"));
  } catch {
    return [];
  }
});
electron.ipcMain.on("chat:save-sessions", (_, data) => {
  try {
    fs__namespace.writeFileSync(chatSessionsFile, JSON.stringify(data, null, 2));
  } catch {
  }
});
electron.ipcMain.on("chat:send", (_, { requestId, message, sessionId, mode, wikiContext, model }) => {
  const claudeEnv = {
    ...process.env,
    PATH: `${path.join(os.homedir(), ".local", "bin")}:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH ?? ""}`
  };
  const resolvedModel = model ?? loadChatSettings().model;
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--model",
    resolvedModel
  ];
  if (sessionId) {
    args.push("--resume", sessionId);
  } else if (mode === "kb" && wikiContext) {
    args.push("--system-prompt", wikiContext);
  } else if (mode === "code") {
    args.push("--add-dir", path.join(os.homedir(), "Documents", "GitHub"));
    args.push("--permission-mode", "bypassPermissions");
  }
  const proc = child_process.spawn(CLAUDE_BIN, args, { env: claudeEnv, stdio: ["pipe", "pipe", "pipe"] });
  proc.stdin.write(message, "utf8");
  proc.stdin.end();
  chatProcesses.set(requestId, proc);
  let lineBuffer = "";
  let stderrBuffer = "";
  proc.stderr.on("data", (data) => {
    if (stderrBuffer.length < 8192) stderrBuffer += data.toString();
  });
  proc.stdout.on("data", (data) => {
    lineBuffer += data.toString();
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        if (event.type === "system" && event.subtype === "init" && event.session_id) {
          send("chat:session-id", requestId, event.session_id);
        }
        if (event.type === "assistant") {
          const content = event.message?.content ?? [];
          const toolUse = content.find((c) => c.type === "tool_use");
          if (toolUse?.name) send("chat:tool-activity", requestId, toolUse.name);
          const textBlock = content.find((c) => c.type === "text");
          if (textBlock?.text) send("chat:chunk", requestId, stripCorrectionBlock(textBlock.text));
        }
        if (event.type === "result" && event.usage) {
          send("chat:usage", requestId, {
            inputTokens: event.usage.input_tokens ?? 0,
            outputTokens: event.usage.output_tokens ?? 0,
            cacheReadTokens: event.usage.cache_read_input_tokens ?? 0,
            cacheCreationTokens: event.usage.cache_creation_input_tokens ?? 0
          });
        }
      } catch {
      }
    }
  });
  proc.on("close", (code) => {
    chatProcesses.delete(requestId);
    if (code !== 0 && code !== null) {
      const detail = stderrBuffer.trim();
      send("chat:error", requestId, detail || `claude exited with code ${code}`);
    } else {
      send("chat:done", requestId);
    }
  });
});
electron.ipcMain.on("chat:stop", (_, requestId) => {
  const proc = chatProcesses.get(requestId);
  if (proc) {
    proc.kill();
    chatProcesses.delete(requestId);
    send("chat:done", requestId);
  }
});
electron.ipcMain.handle("claude:read-session", (_, filename) => {
  const safe = path.basename(filename);
  const file = path.join(claudeSessionsDir, safe);
  try {
    const lines = fs__namespace.readFileSync(file, "utf8").split("\n");
    const messages = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "user" && entry.type !== "assistant") continue;
        const msg = entry.message;
        if (!msg) continue;
        let text = "";
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
        }
        if (text.trim()) {
          messages.push({ role: entry.type, content: text, timestamp: entry.timestamp });
        }
      } catch {
      }
    }
    return messages;
  } catch {
    return [];
  }
});
