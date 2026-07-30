import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import { join, basename, dirname, isAbsolute, resolve, sep } from "path";
import { createServer } from "http";
import { AddressInfo } from "net";
import { execSync, exec, spawn, type ChildProcess } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
import * as fs from "fs";

const TOOL_ENV = { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin` };
import * as pty from "node-pty";
import os from "os";

app.name = "Flight Deck"; 

// ── Resolve ccusage binary + a PATH that includes its node runtime ────────────
function resolveCcusageEnv(): { bin: string; env: NodeJS.ProcessEnv } {
  const nvmDir = `${os.homedir()}/.nvm/versions/node`;
  // Collect all nvm node bin dirs (newest first) to prepend to PATH
  const nvmBinDirs: string[] = [];
  try {
    if (fs.existsSync(nvmDir)) {
      for (const v of fs.readdirSync(nvmDir).sort().reverse()) {
        nvmBinDirs.push(`${nvmDir}/${v}/bin`);
      }
    }
  } catch { /* ignore */ }

  const extraPaths = [
    ...nvmBinDirs,
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  const augmentedPath = [...extraPaths, process.env.PATH ?? ""].join(":");
  const env = { ...process.env, PATH: augmentedPath };

  const candidates = [
    "ccusage",
    ...nvmBinDirs.map((d) => `${d}/ccusage`),
    "/usr/local/bin/ccusage",
    "/opt/homebrew/bin/ccusage",
  ];
  for (const c of candidates) {
    try {
      execSync(`"${c}" --version`, { stdio: "ignore", timeout: 3000, env });
      return { bin: c, env };
    } catch {
      // try next
    }
  }
  return { bin: "ccusage", env }; // last resort
}
const { bin: CCUSAGE_BIN, env: CCUSAGE_ENV } = resolveCcusageEnv();

// ── Resolve claude binary ──────────────────────────────────────────────────────
const CLAUDE_BIN = (() => {
  const candidates = [
    join(os.homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "claude";
})();

// ── Paths ────────────────────────────────────────────────────────────────────
const dataDir = join(os.homedir(), ".terminal-dashboard");
const stateFile = join(dataDir, "state.json");
const historyDir = join(dataDir, "history");
const repoStatsFile = join(dataDir, "repo-stats.json");
const claudeSessionsDir = join(os.homedir(), ".claude", "sessions");
const claudeProjectsDir = join(os.homedir(), ".claude", "projects");
const claudeAgentsDir = join(os.homedir(), ".claude", "agents");
const claudeCommandsDir = join(os.homedir(), ".claude", "commands");
const claudeSkillsDir = join(os.homedir(), ".claude", "skills");
const notesFile = join(dataDir, "notes.json");
const linearIssuesFile = join(dataDir, "linear-issues.json");
const claudeHookScript = join(dataDir, "claude-sessionstart-hook.sh");
const claudeTaskHookScript = join(dataDir, "claude-posttooluse-hook.sh");
// Task-tool events + file writes (todo.md capture). One const so install + status agree on the matcher.
const TASK_HOOK_MATCHER = "TodoWrite|TaskCreate|TaskUpdate|TaskList|Write|Edit|MultiEdit";

fs.mkdirSync(historyDir, { recursive: true });

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
    if (!fs.existsSync(claudeHookScript) || fs.readFileSync(claudeHookScript, "utf8") !== content) {
      fs.writeFileSync(claudeHookScript, content);
    }
    fs.chmodSync(claudeHookScript, 0o755);
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
    if (!fs.existsSync(claudeTaskHookScript) || fs.readFileSync(claudeTaskHookScript, "utf8") !== content) {
      fs.writeFileSync(claudeTaskHookScript, content);
    }
    fs.chmodSync(claudeTaskHookScript, 0o755);
  } catch (e) {
    console.error("[claude-task-hook] failed to write script:", e);
  }
}

// ── Notes ─────────────────────────────────────────────────────────────────────
interface NoteCard { id: string; title: string; command: string; description?: string; type?: "command" | "note"; body?: string; }

function loadNotes(): NoteCard[] {
  try { return JSON.parse(fs.readFileSync(notesFile, "utf8")); }
  catch { return []; }
}

function saveNotes(notes: NoteCard[]) {
  fs.writeFileSync(notesFile, JSON.stringify(notes, null, 2));
}

// ── State ────────────────────────────────────────────────────────────────────
interface SavedPanel {
  number: number;
  title: string;
  group?: string; // panels sharing a group render as one split; absent on pre-split state files
  dir?: "row" | "column"; // split axis of that group
  pinned?: boolean; // title was chosen deliberately, so cwd changes must not overwrite it
}
interface ClaudeSessionEntry {
  claudeSessionId: string;
  cwd: string;
  startedAt: number;
}
type TaskStatus = "pending" | "in_progress" | "completed";
type TodoPriority = "high" | "medium" | "low";
interface Task {
  id: string;
  subject: string;
  status: TaskStatus;
  activeForm?: string;
  updatedAt: number;
  priority?: TodoPriority; // todo-file only
  due?: string; // todo-file only — free text, e.g. "today 9am"
  blocked?: boolean; // todo-file only
}
// Keyed by claudeSessionId (the true owner of a task list); panelNumber lives per record
// because a panel hosts many Claude sessions over its life.
interface ClaudeTaskSession {
  claudeSessionId: string;
  panelNumber: number | null;
  cwd: string;
  source: "task-tools" | "todowrite" | "todo-file" | "manual";
  repoRoot?: string; // todo-file only — the file's repo, so it groups by repo not terminal
  tasks: Record<string, Task>;
  order: string[];
  startedAt: number;
  updatedAt: number;
}
// Per-session delta pushed to the renderer — never the whole store.
interface TaskSummary {
  claudeSessionId: string;
  panelNumber: number | null;
  cwd: string;
  source: "task-tools" | "todowrite" | "todo-file" | "manual";
  repoRoot?: string;
  updatedAt: number;
  tasks: Task[];
  total: number;
  completed: number;
  inProgress: number;
}
interface AppState {
  terminalCounter: number;
  lastPanels: SavedPanel[];
  panelTitles: Record<number, string>;
  panelClaudeSessions: Record<number, ClaudeSessionEntry[]>;
  claudeTaskSessions: Record<string, ClaudeTaskSession>;
}

function loadState(): AppState {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return { panelTitles: {}, panelClaudeSessions: {}, claudeTaskSessions: {}, ...s };
  } catch {
    return { terminalCounter: 0, lastPanels: [], panelTitles: {}, panelClaudeSessions: {}, claudeTaskSessions: {} };
  }
}

let saveStateTimer: ReturnType<typeof setTimeout> | null = null;

// Debounced: callers fire on nearly every panel event; coalesce to one write.
function saveState(_state: AppState) {
  if (saveStateTimer) clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(flushState, 250);
}

function flushState() {
  if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; }
  try { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); } catch {}
}

// ── Repo Stats ───────────────────────────────────────────────────────────────
interface RepoEntry { visits: number; lastSeen: number }
interface RepoStats { [repo: string]: RepoEntry }

let cachedRepoStats: RepoStats | null = null;
let repoStatFlushTimer: ReturnType<typeof setTimeout> | null = null;

function loadRepoStats(): RepoStats {
  if (cachedRepoStats) return cachedRepoStats;
  try { cachedRepoStats = JSON.parse(fs.readFileSync(repoStatsFile, "utf8")); }
  catch { cachedRepoStats = {}; }
  return cachedRepoStats!;
}

const githubDir = join(os.homedir(), "Documents", "GitHub");
// Track last seen repo per session to avoid counting the same dir repeatedly
const sessionLastRepo = new Map<string, string>();
// Latest full CWD per live terminal — used as extra roots for todo.md discovery.
const sessionCwd = new Map<string, string>();

function recordRepoVisit(sessionId: string, cwd: string) {
  if (!cwd.startsWith(githubDir + "/")) return;
  const repoName = cwd.slice(githubDir.length + 1).split("/")[0];
  if (!repoName) return;
  if (sessionLastRepo.get(sessionId) === repoName) return; // debounce same repo
  sessionLastRepo.set(sessionId, repoName);
  const stats = loadRepoStats();
  stats[repoName] = { visits: (stats[repoName]?.visits ?? 0) + 1, lastSeen: Date.now() };
  if (repoStatFlushTimer) clearTimeout(repoStatFlushTimer);
  repoStatFlushTimer = setTimeout(() => fs.writeFileSync(repoStatsFile, JSON.stringify(stats)), 2000);
}

// ── Model pricing (per million tokens, USD) ──────────────────────────────────
interface ModelPrice { input: number; cacheWrite: number; cacheRead: number; output: number }
const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-4-6":     { input: 15,   cacheWrite: 18.75, cacheRead: 1.50, output: 75  },
  "claude-opus-4-5":     { input: 15,   cacheWrite: 18.75, cacheRead: 1.50, output: 75  },
  "claude-sonnet-4-6":   { input: 3,    cacheWrite: 3.75,  cacheRead: 0.30, output: 15  },
  "claude-sonnet-4-5":   { input: 3,    cacheWrite: 3.75,  cacheRead: 0.30, output: 15  },
  "claude-haiku-4-5":    { input: 0.80, cacheWrite: 1.00,  cacheRead: 0.08, output: 4   },
};
const DEFAULT_PRICE: ModelPrice = { input: 3, cacheWrite: 3.75, cacheRead: 0.30, output: 15 };

function modelPrice(model: string): ModelPrice {
  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    if (model.includes(key) || model === key) return price;
  }
  // fuzzy: opus / sonnet / haiku
  if (model.includes("opus"))   return MODEL_PRICES["claude-opus-4-6"];
  if (model.includes("haiku"))  return MODEL_PRICES["claude-haiku-4-5"];
  return DEFAULT_PRICE;
}

function calcCost(inp: number, cacheWrite: number, cacheRead: number, out: number, price: ModelPrice): number {
  return (inp * price.input + cacheWrite * price.cacheWrite + cacheRead * price.cacheRead + out * price.output) / 1_000_000;
}

// ── Claude Stats ──────────────────────────────────────────────────────────────
function computeStreaks(dailyCounts: Record<string, number>): { current: number; longest: number } {
  const active = Object.keys(dailyCounts).filter(d => dailyCounts[d] > 0).sort();
  if (active.length === 0) return { current: 0, longest: 0 };
  let longest = 1, run = 1;
  for (let i = 1; i < active.length; i++) {
    const diff = (new Date(active[i]).getTime() - new Date(active[i - 1]).getTime()) / 86400000;
    if (diff === 1) { run++; if (run > longest) longest = run; }
    else run = 1;
  }
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const last = active[active.length - 1];
  let current = 0;
  if (last === today || last === yesterday) {
    current = 1;
    for (let i = active.length - 2; i >= 0; i--) {
      const diff = (new Date(active[i + 1]).getTime() - new Date(active[i]).getTime()) / 86400000;
      if (diff === 1) current++; else break;
    }
  }
  return { current, longest };
}

// Collect all *.jsonl files across ~/.claude/projects/<project>/*.jsonl
function collectClaudeJsonlFiles(): { file: string; projectDir: string }[] {
  const results: { file: string; projectDir: string }[] = [];
  if (!fs.existsSync(claudeProjectsDir)) return results;
  for (const proj of fs.readdirSync(claudeProjectsDir)) {
    const projPath = join(claudeProjectsDir, proj);
    try {
      if (!fs.statSync(projPath).isDirectory()) continue;
      for (const f of fs.readdirSync(projPath)) {
        if (f.endsWith(".jsonl")) results.push({ file: join(projPath, f), projectDir: proj });
      }
    } catch {}
  }
  return results;
}

function computeClaudeStatsUncached(targetMonth?: string) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7); // "YYYY-MM"
  const month = targetMonth ?? currentMonth;
  const isPastMonth = month < currentMonth;

  // Seed days of target month (day 1 → last day, or today if current month)
  const daysInMonth: Record<string, number> = {};
  const dayTokensInMonth: Record<string, number> = {};
  const d0 = new Date(month + "-01T00:00:00");
  // Last day: first day of next month minus 1
  const nextMonth = new Date(d0);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const lastDay = new Date(nextMonth.getTime() - 86400000).toISOString().slice(0, 10);
  const d1 = new Date((isPastMonth ? lastDay : today) + "T23:59:59");
  for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    daysInMonth[key] = 0;
    dayTokensInMonth[key] = 0;
  }

  const claudeRepoVisits: Record<string, { visits: number; lastSeen: number }> = {};
  const hourCounts: Record<number, number> = {};
  const allTimeDailyCounts: Record<string, number> = {};
  const allTimeDailyModelTokens: Record<string, Record<string, number>> = {};

  let totalSessions = 0;
  let monthSessions = new Set<string>();
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

  // Per-model tracking for cost estimation
  interface ModelUsage { inp: number; cacheWrite: number; cacheRead: number; out: number }
  const monthModelUsage: Record<string, ModelUsage> = {};

  try {
    const files = collectClaudeJsonlFiles();
    totalSessions = files.length;
    for (const { file } of files) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      let fileHasMonthEntry = false;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type !== "user" && entry.type !== "assistant") continue;
          totalMessages++;
          const day: string = entry.timestamp ? (entry.timestamp as string).slice(0, 10) : "";
          if (day) allTimeDailyCounts[day] = (allTimeDailyCounts[day] ?? 0) + 1;
          if (entry.timestamp) {
            const hr = new Date(entry.timestamp as string).getHours();
            hourCounts[hr] = (hourCounts[hr] ?? 0) + 1;
          }
          const isThisMonth = day.startsWith(month);
          if (isThisMonth) {
            monthMessages++;
            if (day in daysInMonth) daysInMonth[day]++;
            fileHasMonthEntry = true;
          }

          // Token aggregation from assistant messages
          if (entry.type === "assistant") {
            const usage = entry.message?.usage;
            if (usage) {
              // input_tokens = new text sent (user msg + small system delta)
              // cache_creation = context written to cache (overhead)
              // cache_read = cached context re-read (overhead, NOT real usage)
              // output_tokens = Claude's actual response
              const inp: number = usage.input_tokens ?? 0;
              const out: number = usage.output_tokens ?? 0;
              const cacheRead: number = usage.cache_read_input_tokens ?? 0;
              const cacheCreate: number = usage.cache_creation_input_tokens ?? 0;
              totalInputTokens += inp;
              totalOutputTokens += out;
              totalCacheReadTokens += cacheRead;
              totalCacheCreationTokens += cacheCreate;
              const model: string = entry.message?.model ?? "unknown";
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
                // Per-model accumulation
                if (!monthModelUsage[model]) monthModelUsage[model] = { inp: 0, cacheWrite: 0, cacheRead: 0, out: 0 };
                monthModelUsage[model].inp += inp;
                monthModelUsage[model].cacheWrite += cacheCreate;
                monthModelUsage[model].cacheRead += cacheRead;
                monthModelUsage[model].out += out;
              }
            }
          }

          // Repo tracking from cwd
          const cwd: string = entry.cwd ?? "";
          if (cwd.startsWith(githubDir + "/")) {
            const repoName = cwd.slice(githubDir.length + 1).split("/")[0];
            if (repoName) {
              const ts = entry.timestamp ? new Date(entry.timestamp as string).getTime() : 0;
              if (!claudeRepoVisits[repoName]) claudeRepoVisits[repoName] = { visits: 0, lastSeen: 0 };
              claudeRepoVisits[repoName].visits++;
              if (ts > claudeRepoVisits[repoName].lastSeen) claudeRepoVisits[repoName].lastSeen = ts;
            }
          }
        } catch {}
      }
      if (fileHasMonthEntry) monthSessions.add(file);
    }
  } catch {}

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
        costContent: (u.inp * p.input + u.out * p.output) / 1_000_000,
        costCache: (u.cacheWrite * p.cacheWrite + u.cacheRead * p.cacheRead) / 1_000_000,
        inputTokens: u.inp,
        outputTokens: u.out,
        cacheWriteTokens: u.cacheWrite,
        cacheReadTokens: u.cacheRead,
      };
    }).sort((a, b) => b.cost - a.cost),
    dailyCounts: Object.entries(daysInMonth).map(([date, count]) => ({ date, count })),
    dailyTokens: Object.entries(dayTokensInMonth).map(([date, tokens]) => ({ date, tokens })),
    claudeRepoVisits,
    activeDays: Object.values(allTimeDailyCounts).filter(c => c > 0).length,
    currentStreak: computeStreaks(allTimeDailyCounts).current,
    longestStreak: computeStreaks(allTimeDailyCounts).longest,
    peakHour: (() => {
      const entry = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
      return entry ? Number(entry[0]) : null;
    })() as number | null,
    allTimeDailyCounts,
    allTimeDailyModelTokens,
  };
}

// Cache keyed by month on a signature of all jsonl files' mtime+size.
// Reading + JSON.parsing every history file blocked the main process for
// seconds on each Stats open; recompute only when Claude activity actually changes.
const statsCache = new Map<string, { sig: string; data: ReturnType<typeof computeClaudeStatsUncached> }>();

function claudeFilesSignature(): string {
  return collectClaudeJsonlFiles()
    .map(({ file }) => {
      try { const s = fs.statSync(file); return `${file}:${s.mtimeMs}:${s.size}`; }
      catch { return file; }
    })
    .sort()
    .join("|");
}

function computeClaudeStats(targetMonth?: string) {
  const key = targetMonth ?? new Date(Date.now()).toISOString().slice(0, 7);
  const sig = claudeFilesSignature();
  const hit = statsCache.get(key);
  if (hit && hit.sig === sig) return hit.data;
  const data = computeClaudeStatsUncached(targetMonth);
  statsCache.set(key, { sig, data });
  return data;
}

function pruneHistory() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  try {
    for (const f of fs.readdirSync(historyDir)) {
      const p = join(historyDir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch {}
}

// ── Runtime ──────────────────────────────────────────────────────────────────
const sessions = new Map<string, pty.IPty>();
const sessionPanelNumbers = new Map<string, number>();
const oscBuffers = new Map<string, string>();
let mainWindow: BrowserWindow | null = null;
let dashboardPort = 0;
let zdotdir = "";
let focusedSessionId: string | null = null;
let state = loadState();

pruneHistory();

function send(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function historyPath(num: number) {
  return join(historyDir, `terminal-${num}.log`);
}

// ── PTY output batching ────────────────────────────────────────────────────────
// Coalesce PTY chunks into ~8ms batches: one IPC message + one xterm write per
// batch instead of per raw chunk (heavy build/stream output was the hot path).
const pendingOutput = new Map<string, string>();
const outputFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const OUTPUT_FLUSH_MS = 8;
const OUTPUT_FLUSH_BYTES = 64 * 1024;

function flushOutput(sessionId: string) {
  const timer = outputFlushTimers.get(sessionId);
  if (timer) { clearTimeout(timer); outputFlushTimers.delete(sessionId); }
  const data = pendingOutput.get(sessionId);
  if (data) { pendingOutput.delete(sessionId); send(`terminal:output:${sessionId}`, data); }
}

function queueOutput(sessionId: string, data: string) {
  const merged = (pendingOutput.get(sessionId) ?? "") + data;
  pendingOutput.set(sessionId, merged);
  if (merged.length >= OUTPUT_FLUSH_BYTES) { flushOutput(sessionId); return; } // bound latency/memory on big bursts
  if (!outputFlushTimers.has(sessionId)) {
    outputFlushTimers.set(sessionId, setTimeout(() => flushOutput(sessionId), OUTPUT_FLUSH_MS));
  }
}

// ── Git HEAD watching ─────────────────────────────────────────────────────────
// The shell's precmd hook only reports the branch between prompts, so a checkout
// made by a foreground program (Claude, vim) or another panel leaves the title
// bar stale. Watching HEAD keeps every panel in the repo correct in real time.
interface GitHeadWatch { watcher: fs.FSWatcher; branch: string; debounce?: ReturnType<typeof setTimeout> }
const gitHeadWatches = new Map<string, GitHeadWatch>(); // gitDir → watch
const sessionGitDir = new Map<string, string>();        // sessionId → gitDir

// Resolve the dir holding HEAD: walk up to `.git`, following the worktree pointer file.
function resolveGitDir(cwd: string): string | null {
  let dir = cwd;
  for (let i = 0; i < 64; i++) {
    const dotGit = join(dir, ".git");
    try {
      const st = fs.statSync(dotGit);
      if (st.isDirectory()) return dotGit;
      if (st.isFile()) {
        const m = fs.readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m);
        if (m) return isAbsolute(m[1].trim()) ? m[1].trim() : resolve(dir, m[1].trim());
      }
    } catch { /* not here — keep walking up */ }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function readGitBranch(gitDir: string): string {
  try {
    const head = fs.readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    return head.startsWith("ref: refs/heads/") ? head.slice("ref: refs/heads/".length) : "";
  } catch { return ""; }
}

function trackGitHead(sessionId: string, cwd: string) {
  const gitDir = cwd ? resolveGitDir(cwd) : null;
  if (sessionGitDir.get(sessionId) === gitDir) return;
  untrackGitHead(sessionId);
  if (!gitDir) return;
  sessionGitDir.set(sessionId, gitDir);
  if (gitHeadWatches.has(gitDir)) return; // another panel already watches this repo

  try {
    // Watch the dir, not HEAD itself — git rewrites HEAD via rename, detaching a file watch.
    const watcher = fs.watch(gitDir, (_event, filename) => {
      if (filename && filename !== "HEAD") return;
      const w = gitHeadWatches.get(gitDir);
      if (!w) return;
      if (w.debounce) clearTimeout(w.debounce);
      w.debounce = setTimeout(() => emitGitBranch(gitDir), 80);
    });
    gitHeadWatches.set(gitDir, { watcher, branch: readGitBranch(gitDir) });
  } catch { /* repo dir vanished — the next OSC update re-tracks */ }
}

function emitGitBranch(gitDir: string) {
  const w = gitHeadWatches.get(gitDir);
  if (!w) return;
  w.debounce = undefined;
  const branch = readGitBranch(gitDir);
  if (branch === w.branch) return;
  w.branch = branch;
  for (const [sessionId, dir] of sessionGitDir) {
    if (dir !== gitDir) continue;
    const cwd = sessionCwd.get(sessionId);
    if (cwd) send("terminal:cwd-update", sessionId, cwd, branch); // cwd is required — the renderer overwrites it
  }
}

function untrackGitHead(sessionId: string) {
  const gitDir = sessionGitDir.get(sessionId);
  if (!gitDir) return;
  sessionGitDir.delete(sessionId);
  if ([...sessionGitDir.values()].includes(gitDir)) return; // still in use by another panel
  const w = gitHeadWatches.get(gitDir);
  if (w) {
    if (w.debounce) clearTimeout(w.debounce);
    try { w.watcher.close(); } catch {}
    gitHeadWatches.delete(gitDir);
  }
}

function createSession(
  cols: number,
  rows: number,
  panelNumber?: number,
  initialCommand?: string
): { sessionId: string; number: number } {
  const num = panelNumber ?? ++state.terminalCounter;
  if (!panelNumber) flushState(); // persist monotonic counter synchronously to avoid reuse on crash

  const sessionId = crypto.randomUUID();
  const shell =
    process.env.SHELL ||
    (process.platform === "win32" ? "cmd.exe" : "/bin/zsh");

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: os.homedir(),
    env: {
      ...process.env,
      ZDOTDIR: zdotdir || undefined,
      TERMINAL_DASHBOARD_PORT: String(dashboardPort),
      TERMINAL_SESSION_ID: sessionId,
    } as Record<string, string>,
  });

  const histStream = fs.createWriteStream(historyPath(num), { flags: "a" });
  oscBuffers.set(sessionId, "");

  ptyProcess.onData((rawData) => {
    const prev = oscBuffers.get(sessionId) ?? "";

    // Fast path: no pending partial and no OSC introducer → skip all OSC scanning.
    // Normal shell output has no "\x1b]", so this avoids a regex scan per chunk.
    if (!prev && rawData.indexOf("\x1b]") === -1) {
      histStream.write(rawData);
      queueOutput(sessionId, rawData);
      return;
    }

    // Prepend any previously buffered partial OSC sequence
    let buf = prev + rawData;

    // Process all complete OSC 9999 sequences (CWD+git updates), strip them
    const oscRe = /\x1b\]9999;([^\x1c]*)\x1c([^\x07]*)\x07/;
    let m: RegExpMatchArray | null;
    while ((m = oscRe.exec(buf)) !== null) {
      send("terminal:cwd-update", sessionId, m[1], m[2]);
      recordRepoVisit(sessionId, m[1]);
      if (m[1]) sessionCwd.set(sessionId, m[1]);
      trackGitHead(sessionId, m[1]);
      buf = buf.slice(0, m.index) + buf.slice(m.index! + m[0].length);
    }

    // If a partial OSC sequence starts near the end, hold it back for the next chunk
    const partialIdx = buf.lastIndexOf("\x1b]9999;");
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
    flushOutput(sessionId); // flush buffered output before the exit marker
    oscBuffers.delete(sessionId);
    pendingOutput.delete(sessionId);
    const timer = outputFlushTimers.get(sessionId);
    if (timer) { clearTimeout(timer); outputFlushTimers.delete(sessionId); }
    sessionLastRepo.delete(sessionId);
    sessionCwd.delete(sessionId);
    untrackGitHead(sessionId);
    sessionPanelNumbers.delete(sessionId);
    histStream.end();
    send(`terminal:exit:${sessionId}`);
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, ptyProcess);
  sessionPanelNumbers.set(sessionId, num);

  // Send initial CWD immediately so the panel title bar shows it before precmd fires
  setTimeout(() => send("terminal:cwd-update", sessionId, os.homedir(), ""), 300);

  if (initialCommand) {
    setTimeout(() => ptyProcess.write(initialCommand + "\r"), 1200);
  }

  return { sessionId, number: num };
}

// ── Claude task tracking ──────────────────────────────────────────────────────
// A tool result can arrive as an object or a JSON string; coerce both to an object.
function coerceObj(x: unknown): Record<string, unknown> {
  if (typeof x === "string") { try { return JSON.parse(x); } catch { return {}; } }
  return (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
}

function normTaskStatus(s: unknown): TaskStatus | undefined {
  return s === "pending" || s === "in_progress" || s === "completed" ? s : undefined;
}

function summarizeTaskSession(s: ClaudeTaskSession): TaskSummary {
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
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
  };
}

function upsertTask(s: ClaudeTaskSession, id: string, patch: Partial<Task>) {
  const existing = s.tasks[id];
  if (existing) {
    s.tasks[id] = { ...existing, ...patch, updatedAt: Date.now() };
  } else {
    s.tasks[id] = { id, subject: patch.subject ?? "(task)", status: patch.status ?? "pending", activeForm: patch.activeForm, updatedAt: Date.now() };
    s.order.push(id);
  }
}

// Bound state.json growth — keep the 50 most recently touched task sessions.
function pruneTaskSessions() {
  const ids = Object.keys(state.claudeTaskSessions);
  if (ids.length <= 50) return;
  const keep = new Set(
    ids.map((id) => state.claudeTaskSessions[id])
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50)
      .map((s) => s.claudeSessionId)
  );
  for (const id of ids) {
    if (keep.has(id) || state.claudeTaskSessions[id]?.source === "manual") continue; // never evict the manual list
    delete state.claudeTaskSessions[id];
  }
}

// Reducer for a Claude PostToolUse payload (TaskCreate/TaskUpdate/TaskList/TodoWrite).
function ingestClaudeTaskEvent(terminalSessionId: string, payload: Record<string, unknown>) {
  const toolName = payload.tool_name;
  // File writes route to the todo.md parser — keyed by path, not claudeSessionId.
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    ingestTodoFileEvent(payload);
    return;
  }
  const claudeSessionId = payload?.session_id;
  if (typeof claudeSessionId !== "string" || !claudeSessionId) return;
  const toolInput = coerceObj(payload.tool_input);
  // Result field name varies by CLI version — accept either.
  const result = coerceObj(payload.tool_response ?? payload.tool_output);
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";

  // Resolve panel at ingest — sessionPanelNumbers is deleted on PTY exit, so a late event
  // would otherwise lose its panel. Fall back to the already-stored value.
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
      updatedAt: Date.now(),
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
          status: normTaskStatus(tk.status) ?? "pending",
        });
      });
      break;
    }
    case "TaskUpdate": {
      const id = String(toolInput.taskId ?? toolInput.id ?? toolInput.task_id ?? "");
      if (!id) break;
      if (toolInput.status === "deleted") {
        if (s.tasks[id]) { delete s.tasks[id]; s.order = s.order.filter((x) => x !== id); }
        break;
      }
      const patch: Partial<Task> = {};
      if (toolInput.subject != null) patch.subject = String(toolInput.subject);
      const st = normTaskStatus(toolInput.status);
      if (st) patch.status = st;
      upsertTask(s, id, patch);
      break;
    }
    case "TaskList": {
      // Authoritative snapshot — rebuild, but guard a malformed non-array so a good list isn't wiped.
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
        s.tasks[id] = { id, subject: String(td.content ?? td.subject ?? "(todo)"), activeForm: typeof td.activeForm === "string" ? td.activeForm : undefined, status: normTaskStatus(td.status) ?? "pending", updatedAt: Date.now() };
        s.order.push(id);
      });
      break;
    }
    default:
      return;
  }

  s.updatedAt = Date.now();
  pruneTaskSessions();
  saveState(state);
  send("terminal:claude-tasks-updated", summarizeTaskSession(s));
}

// ── todo.md file capture ──────────────────────────────────────────────────────
// GitHub-style task items. Markdown has no in_progress state, so items are pending or completed.
interface ParsedTodo { subject: string; status: TaskStatus; priority?: TodoPriority; due?: string; blocked?: boolean }
// GitHub task line: "- [ ] subject" / "- [x] subject". Shared so the parser and line-delete index items identically.
const TODO_ITEM_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*\S)\s*$/;
// Inline metadata convention: leading (P0|P1|P2), @due(...), @blocked/[blocked] — parsed, then stripped from the subject.
function parseTodoMarkdown(content: string): ParsedTodo[] {
  const out: ParsedTodo[] = [];
  for (const line of content.split("\n")) {
    const m = TODO_ITEM_RE.exec(line);
    if (!m) continue;
    let subject = m[2];
    let priority: TodoPriority | undefined;
    let due: string | undefined;
    let blocked = false;
    const pri = /^\((P[012])\)\s*/i.exec(subject);
    if (pri) {
      const p = pri[1].toUpperCase();
      priority = p === "P0" ? "high" : p === "P1" ? "medium" : "low";
      subject = subject.slice(pri[0].length);
    }
    const dueM = /@due\(([^)]*)\)/i.exec(subject);
    if (dueM) { due = dueM[1].trim() || undefined; subject = subject.replace(dueM[0], ""); }
    const blkM = /(@blocked|\[blocked\])/i.exec(subject);
    if (blkM) { blocked = true; subject = subject.replace(blkM[0], ""); }
    subject = subject.replace(/\s{2,}/g, " ").trim();
    out.push({ subject, status: m[1] === " " ? "pending" : "completed", priority, due, blocked: blocked || undefined });
  }
  return out;
}

const todoFileWatchers = new Map<string, fs.FSWatcher>();
const todoFileDebounce = new Map<string, NodeJS.Timeout>();
const MAX_TODO_WATCHERS = 50;

// Resolve a file-tool payload to an absolute *todo.md path, or null if out of scope.
function resolveTodoPath(payload: Record<string, unknown>): string | null {
  const toolInput = coerceObj(payload.tool_input);
  const raw = typeof toolInput.file_path === "string" ? toolInput.file_path
    : typeof toolInput.filePath === "string" ? toolInput.filePath : "";
  if (!raw) return null;
  const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
  const abs = isAbsolute(raw) ? raw : cwd ? resolve(cwd, raw) : raw;
  if (!/todo\.md$/i.test(basename(abs))) return null;
  if (abs.includes("/node_modules/") || abs.includes("/.git/")) return null;
  return abs;
}

// A todo.md belongs to its repo, not the terminal that wrote it — walk up to the .git root
// (fallback: the file's own dir) so the drawer groups by repo.
function deriveRepoRoot(absFilePath: string): string {
  let dir = dirname(absFilePath);
  while (true) {
    if (fs.existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return dirname(absFilePath);
    dir = parent;
  }
}

// Read + parse a *todo.md, upsert its group (authoritative replace, like TaskList).
// Returns false when the file is gone/empty so the caller can drop the group.
// panelNumber stays null: file groups map to a repo (drawer-only), never a panel badge.
function applyTodoFile(absPath: string): boolean {
  let content: string;
  try { content = fs.readFileSync(absPath, "utf8"); } catch { return false; }
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
  saveState(state);
  send("terminal:claude-tasks-updated", summarizeTaskSession(s));
  return true;
}

function dropTodoFileGroup(absPath: string) {
  const key = `file:${absPath}`;
  const s = state.claudeTaskSessions[key];
  if (s) {
    s.tasks = {}; s.order = [];
    send("terminal:claude-tasks-updated", summarizeTaskSession(s)); // total 0 → UI drops the card
    delete state.claudeTaskSessions[key];
    saveState(state);
  }
  unwatchTodoFile(absPath);
}

function ingestTodoFileEvent(payload: Record<string, unknown>) {
  const absPath = resolveTodoPath(payload);
  if (!absPath) return;
  if (applyTodoFile(absPath)) watchTodoFile(absPath);
  else dropTodoFileGroup(absPath);
}

function watchTodoFile(absPath: string) {
  if (todoFileWatchers.has(absPath)) return;
  if (todoFileWatchers.size >= MAX_TODO_WATCHERS) {
    console.warn(`[todo-watch] cap ${MAX_TODO_WATCHERS} reached — not watching ${absPath}; hand-edits won't live-update`);
    return;
  }
  try {
    const w = fs.watch(absPath, (event) => {
      const prev = todoFileDebounce.get(absPath);
      if (prev) clearTimeout(prev);
      todoFileDebounce.set(absPath, setTimeout(() => reparseTodoFile(absPath, event), 150));
    });
    todoFileWatchers.set(absPath, w);
  } catch { /* file vanished between parse and watch — ignore */ }
}

function reparseTodoFile(absPath: string, event: string) {
  todoFileDebounce.delete(absPath);
  if (!fs.existsSync(absPath)) { dropTodoFileGroup(absPath); return; }
  if (!applyTodoFile(absPath)) { dropTodoFileGroup(absPath); return; }
  // Editors atomic-save via rename, detaching the watch — re-arm on the new inode.
  if (event === "rename") { unwatchTodoFile(absPath); watchTodoFile(absPath); }
}

function unwatchTodoFile(absPath: string) {
  const w = todoFileWatchers.get(absPath);
  if (w) { try { w.close(); } catch {} todoFileWatchers.delete(absPath); }
  const t = todoFileDebounce.get(absPath);
  if (t) { clearTimeout(t); todoFileDebounce.delete(absPath); }
}

// Persisted todo-file groups load with stale parse output and no live watcher.
// On boot, re-parse each with the current parser + re-arm its watch; drop any whose file vanished.
function restoreTodoFileGroups() {
  for (const key of Object.keys(state.claudeTaskSessions)) { // snapshot — safe against mid-loop deletes
    if (state.claudeTaskSessions[key]?.source !== "todo-file") continue;
    const absPath = key.startsWith("file:") ? key.slice(5) : state.claudeTaskSessions[key].cwd;
    if (applyTodoFile(absPath)) watchTodoFile(absPath);
    else dropTodoFileGroup(absPath);
  }
}

// ── todo.md filesystem discovery ───────────────────────────────────────────────
// Actively find *todo.md on disk (not just ones Claude writes). Bounded BFS so a deep
// tree or symlink loop can't hang: dedup by realpath, cap depth/dirs/files, skip heavy dirs.
const SCAN_SKIP_DIRS = new Set(["node_modules", ".git", "build", "dist", "out", ".next", "target", "venv", ".venv", "vendor", ".cache", "coverage", "Pods"]);
const SCAN_MAX_DEPTH = 5;
const SCAN_MAX_DIRS = 4000;
const SCAN_MAX_FILES = 200;

async function findTodoFiles(roots: string[]): Promise<string[]> {
  const found = new Set<string>();
  const seen = new Set<string>();
  const queue: Array<{ dir: string; depth: number }> = [];
  const enqueue = (p: string, depth: number) => {
    let real: string;
    try { real = fs.realpathSync(p); } catch { return; } // skip missing dirs; resolve symlinks so dedup + loop-guard work
    if (seen.has(real)) return;
    seen.add(real);
    queue.push({ dir: real, depth });
  };
  for (const r of roots) enqueue(r, 0);
  let budget = SCAN_MAX_DIRS;
  while (queue.length && budget > 0 && found.size < SCAN_MAX_FILES) {
    const { dir, depth } = queue.shift()!;
    budget--;
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        // Descend into .claude (canonical Claude tasks dir, e.g. .claude/local/tasks/todo.md); skip other dot-dirs.
        const skipDot = e.name.startsWith(".") && e.name !== ".claude";
        if (depth >= SCAN_MAX_DEPTH || skipDot || SCAN_SKIP_DIRS.has(e.name)) continue;
        enqueue(join(dir, e.name), depth + 1);
      } else if (/^todo\.md$/i.test(e.name)) {
        found.add(join(dir, e.name));
      }
    }
  }
  return [...found];
}

// Scan the GitHub dir + open terminal CWDs, registering each *todo.md as a file group.
// Idempotent: applyTodoFile replaces, watchTodoFile no-ops if already watched. Returns files registered.
async function scanTodoFiles(): Promise<number> {
  const roots = [githubDir, ...new Set([...sessionCwd.values()].filter(Boolean))];
  const files = await findTodoFiles(roots);
  let applied = 0;
  for (const abs of files) {
    if (applyTodoFile(abs)) { watchTodoFile(abs); applied++; }
  }
  return applied;
}

// ── HTTP server (new_terminal / nt shell command) ─────────────────────────────
function startHttpServer() {
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/new-terminal") {
      const { sessionId, number } = createSession(220, 50);
      state.lastPanels.push({ number, title: `terminal ${number}` });
      saveState(state);
      send("terminal:new-panel", sessionId, number);
      res.writeHead(200);
      res.end(sessionId);
    } else if (req.method === "POST" && req.url === "/update-cwd") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { sessionId, cwd, gitBranch } = JSON.parse(body);
          send("terminal:cwd-update", sessionId, cwd, gitBranch ?? "");
        } catch {}
        res.writeHead(200);
        res.end();
      });
    } else if (req.method === "POST" && req.url === "/claude-session") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { terminalSessionId, claudeSessionId, cwd } = JSON.parse(body);
          const panelNumber = sessionPanelNumbers.get(terminalSessionId);
          if (panelNumber !== undefined && typeof claudeSessionId === "string" && claudeSessionId) {
            const list = state.panelClaudeSessions[panelNumber] ?? [];
            if (!list.some((e) => e.claudeSessionId === claudeSessionId)) {
              list.push({ claudeSessionId, cwd: typeof cwd === "string" ? cwd : "", startedAt: Date.now() });
              // Keep only the last 20 sessions per panel
              state.panelClaudeSessions[panelNumber] = list.slice(-20);
              saveState(state);
              send("terminal:claude-session-recorded", panelNumber, claudeSessionId);
            }
          }
        } catch {}
        res.writeHead(200);
        res.end();
      });
    } else if (req.method === "POST" && req.url === "/claude-tasks") {
      const tsid = String(req.headers["x-terminal-session-id"] ?? "");
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try { ingestClaudeTaskEvent(tsid, JSON.parse(body)); } catch {}
        res.writeHead(200);
        res.end();
      });
    } else if (req.method === "POST" && req.url === "/cd") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { cwd } = JSON.parse(body);
          const target = focusedSessionId ?? [...sessions.keys()].at(-1);
          if (target && cwd) {
            sessions.get(target)?.write(`cd ${JSON.stringify(cwd)}\r`);
          }
        } catch {}
        res.writeHead(200);
        res.end();
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(0, "127.0.0.1", () => {
    dashboardPort = (server.address() as AddressInfo).port;
    fs.writeFileSync(join(dataDir, "port"), String(dashboardPort));
    setupZdotdir();
    createWindow();
  });
}

// ── Shell injection ───────────────────────────────────────────────────────────
function setupZdotdir() {
  zdotdir = fs.mkdtempSync(join(os.tmpdir(), "terminal-dashboard-"));

  const scriptPath = join(zdotdir, "new-terminal");
  fs.writeFileSync(
    scriptPath,
    `#!/bin/zsh\ncurl -s -X POST "http://127.0.0.1:$TERMINAL_DASHBOARD_PORT/new-terminal" > /dev/null\n`
  );
  fs.chmodSync(scriptPath, 0o755);

  fs.writeFileSync(
    join(zdotdir, ".zshrc"),
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
(( ! \${+functions[_zsh_autosuggest_start]} )) && \
  [[ -f /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]] && \
  source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh

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

exit() {
  echo "\\033[36mBye\\033[0m"
  builtin exit "$@"
}

# Report CWD + git branch via OSC escape sequence (real-time, no curl needed).
# Also sets the prompt from the same branch lookup — one git call per prompt, not two.
_td_update_cwd() {
  local _git_branch=""
  _git_branch=$(git symbolic-ref --short HEAD 2>/dev/null)
  printf "\\033]9999;%s\\034%s\\007" "$PWD" "$_git_branch"
  [[ -n "$FLIGHT_DECK_KEEP_PROMPT" ]] && return

  # Short prompt: the panel header already carries the full branch and sha, so the
  # prompt only needs repo + ticket. The full bracketed path wrapped three lines per command.
  local _d="$PWD"
  case "$_d" in
    "$HOME/Documents/GitHub"/*) _d="~/\${_d#$HOME/Documents/GitHub/}" ;;
    "$HOME") _d="~" ;;
    "$HOME"/*) _d="~/\${_d#$HOME/}" ;;
  esac
  local _ticket=""
  [[ -n "$_git_branch" ]] && _ticket="  %F{#7a8291}\${_git_branch%%/*}%f"
  PROMPT="%F{#66baff}\${_d}%f\${_ticket} %F{#008cff}›%f "
  RPROMPT=""
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

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#00000000",
    transparent: true,
    vibrancy: "under-window",
    visualEffectState: "active",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../../out/renderer/index.html"));
  }
}

app.setAboutPanelOptions({
  applicationName: "Flight Deck",
  applicationVersion: "0.1.0",
  copyright: "© 2026 Tung Tran <tranthaitung.inbox@gmail.com>",
  iconPath: join(__dirname, "../../build/icons/icon.icns"),
});

app.whenReady().then(() => {
  ensureClaudeHookScript();
  ensureClaudeTaskHookScript();
  startHttpServer(); // createWindow() is called inside once zdotdir is ready
  restoreTodoFileGroups(); // re-parse + re-watch persisted todo.md groups so they pick up parser changes
  scanTodoFiles().catch((e) => console.error("[todo-scan] startup scan failed:", e)); // discover todo.md on disk (fire-and-forget)
  // Kick off an immediate Linear sync on startup, then repeat every 4 hours
  syncLinear();
  setInterval(() => syncLinear(), FOUR_HOURS_MS);

  // Watch Claude config dirs — debounce to avoid floods on bulk file saves
  let claudeConfigTimer: ReturnType<typeof setTimeout> | null = null;
  const notifyClaudeConfigChanged = () => {
    if (claudeConfigTimer) clearTimeout(claudeConfigTimer);
    claudeConfigTimer = setTimeout(() => send("claude:config-changed"), 300);
  };
  for (const dir of [claudeAgentsDir, claudeCommandsDir, claudeSkillsDir]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.watch(dir, notifyClaudeConfigChanged);
    } catch { /* dir may not exist yet */ }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // zdotdir was deleted when the window closed — recreate it before opening
      setupZdotdir();
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  sessions.forEach((p) => p.kill());
  sessions.clear();
  // On macOS the app stays alive in the dock — clean up zdotdir only on full quit
  if (process.platform !== "darwin") {
    if (zdotdir) fs.rmSync(zdotdir, { recursive: true, force: true });
    app.quit();
  }
  mainWindow = null;
});

app.on("before-quit", () => {
  for (const w of todoFileWatchers.values()) { try { w.close(); } catch {} }
  flushState(); // ensure the debounced state write lands before exit
  if (zdotdir) fs.rmSync(zdotdir, { recursive: true, force: true });
});

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle("terminal:get-state", () => state);

ipcMain.handle(
  "terminal:create",
  (_, cols: number, rows: number, panelNumber?: number, initialCommand?: string) => {
    return createSession(cols, rows, panelNumber, initialCommand);
  }
);

ipcMain.handle("terminal:get-history", (_, num: number): string => {
  const file = historyPath(num);
  if (!fs.existsSync(file)) return "";
  const stat = fs.statSync(file);
  const readSize = Math.min(stat.size, 200 * 1024); // last 200 KB
  const buf = Buffer.alloc(readSize);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
  fs.closeSync(fd);
  return buf.toString();
});

ipcMain.on(
  "terminal:save-panels",
  (_, panels: { number: number; title: string; group?: string; dir?: "row" | "column"; pinned?: boolean }[]) => {
    state.lastPanels = panels;
    for (const p of panels) {
      if (p.title && p.title !== `terminal ${p.number}`) {
        state.panelTitles[p.number] = p.title;
      }
    }
    saveState(state);
  }
);

ipcMain.handle("terminal:list-history", () => {
  try {
    return fs
      .readdirSync(historyDir)
      .filter((f) => f.startsWith("terminal-") && f.endsWith(".log"))
      .map((f) => {
        const num = parseInt(f.replace("terminal-", "").replace(".log", ""));
        const stat = fs.statSync(join(historyDir, f));
        return { number: num, size: stat.size, lastModified: stat.mtimeMs, title: state.panelTitles[num] };
      })
      .sort((a, b) => b.number - a.number);
  } catch {
    return [];
  }
});

ipcMain.on("terminal:write", (_, id: string, data: string) => {
  sessions.get(id)?.write(data);
});

ipcMain.on("terminal:resize", (_, id: string, cols: number, rows: number) => {
  sessions.get(id)?.resize(cols, rows);
});

ipcMain.on("terminal:close", (_, id: string) => {
  sessions.get(id)?.kill();
  sessions.delete(id);
});

ipcMain.on("terminal:delete-history", (_, num: number) => {
  try { fs.unlinkSync(historyPath(num)); } catch {}
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
  if (changed) saveState(state);
});

ipcMain.on("terminal:set-focused", (_, sessionId: string) => {
  focusedSessionId = sessionId;
});

ipcMain.on("terminal:set-background-color", (_, color: string) => {
  mainWindow?.setBackgroundColor(color);
});

// ── Notes IPC ─────────────────────────────────────────────────────────────────
ipcMain.handle("notes:list", () => loadNotes());

ipcMain.on("notes:save", (_, card: NoteCard) => {
  const notes = loadNotes();
  const idx = notes.findIndex((n) => n.id === card.id);
  if (idx >= 0) notes[idx] = card; else notes.push(card);
  saveNotes(notes);
});

ipcMain.on("notes:delete", (_, id: string) => {
  saveNotes(loadNotes().filter((n) => n.id !== id));
});

// ── Stats IPC ─────────────────────────────────────────────────────────────────
ipcMain.handle("stats:get-data", (_, month?: string) => {
  const { claudeRepoVisits, ...claude } = computeClaudeStats(month);
  // Merge terminal OSC tracking + Claude session cwd tracking
  const terminalRepoMap = loadRepoStats();
  const merged: Record<string, { visits: number; lastSeen: number }> = {};
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
  const repos = Object.entries(merged)
    .map(([name, s]) => ({ name, visits: s.visits, lastSeen: s.lastSeen }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 12);
  return { claude, repos };
});

// Most-visited repos for the directory picker — cheap: terminal OSC visit counts only.
// Filters to still-existing dirs before slicing so deleted repos don't leave dead chips.
ipcMain.handle("fs:frequent-dirs", (): { name: string }[] => {
  const stats = loadRepoStats();
  return Object.entries(stats)
    .sort((a, b) => b[1].visits - a[1].visits)
    .map(([name]) => name)
    .filter((name) => fs.existsSync(join(githubDir, name)))
    .slice(0, 10)
    .map((name) => ({ name }));
});

// ── Usage Sessions IPC (ccusage) ──────────────────────────────────────────────
function resolveProjectPath(sessionId: string): string | null {
  if (!sessionId.startsWith("-")) return null;
  function dfs(remaining: string, current: string): string | null {
    if (remaining.length === 0) return fs.existsSync(current) ? current : null;
    const dashIdx = remaining.indexOf("-");
    if (dashIdx === -1) {
      const full = current + remaining;
      return fs.existsSync(full) ? full : null;
    }
    const prefix = remaining.slice(0, dashIdx);
    const rest = remaining.slice(dashIdx + 1);
    if (prefix.length > 0) {
      const asDir = current + prefix;
      if (fs.existsSync(asDir) && fs.statSync(asDir).isDirectory()) {
        const r = dfs(rest, asDir + "/");
        if (r !== null) return r;
      }
    }
    return dfs(rest, current + prefix + "-");
  }
  return dfs(sessionId.slice(1), "/");
}

ipcMain.handle("usage:get-sessions", async () => {
  try {
    const { stdout } = await execAsync(`"${CCUSAGE_BIN}" session --json`, { timeout: 10000, env: CCUSAGE_ENV });
    const data = JSON.parse(stdout);
    const raw: Array<{
      sessionId: string; totalCost: number; totalTokens: number;
      inputTokens: number; outputTokens: number;
      lastActivity: string; modelsUsed: string[];
    }> = data.sessions ?? data;
    return raw
      .map((s) => ({ ...s, resolvedPath: resolveProjectPath(s.sessionId) }))
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  } catch {
    return [];
  }
});

// ── Claude.ai Usage Limits IPC ────────────────────────────────────────────────
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
    if (fs.existsSync(p)) return p;
  }
  return "python3";
})();

ipcMain.handle("usage:get-limits", async () => {
  try {
    const pyPath = join(os.tmpdir(), "td_claude_limits.py");
    fs.writeFileSync(pyPath, CLAUDE_LIMITS_PY);
    const { stdout } = await execAsync(`"${PYTHON3_PATH}" "${pyPath}"`, { timeout: 15000 });
    try { fs.unlinkSync(pyPath); } catch {}
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
});

// ── iTerm2 Font IPC ───────────────────────────────────────────────────────────
ipcMain.handle("iterm2:get-font", () => {
  try {
    const plistPath = join(os.homedir(), "Library/Preferences/com.googlecode.iterm2.plist");
    const tmpPath = join(os.tmpdir(), "td_iterm2_font.plist");

    // xml1 works reliably; json conversion fails on plist types iTerm2 uses
    execSync(`plutil -convert xml1 -o "${tmpPath}" "${plistPath}"`);
    const pyScript = join(os.tmpdir(), "td_iterm2_font.py");
    fs.writeFileSync(pyScript, [
      `import plistlib`,
      `with open(${JSON.stringify(tmpPath)}, 'rb') as f:`,
      `    data = plistlib.load(f)`,
      `profiles = data.get('New Bookmarks', [])`,
      `print(profiles[0].get('Normal Font', '') if profiles else '')`,
    ].join("\n"));
    const fontStr = execSync(`python3 ${pyScript}`, { timeout: 5000 }).toString().trim();
    try { fs.unlinkSync(tmpPath); } catch {}
    try { fs.unlinkSync(pyScript); } catch {}

    if (!fontStr) return null;

    // Format: "PostScriptName Size" e.g. "MesloLGSDZNFM-Regular 12"
    const lastSpace = fontStr.lastIndexOf(" ");
    const postScriptName = fontStr.slice(0, lastSpace);
    const size = parseInt(fontStr.slice(lastSpace + 1), 10);

    // Resolve PostScript name → CSS family name via fc-list (available via Homebrew on macOS).
    // We only need the family name — system fonts are accessible to Electron's renderer
    // directly by CSS family name without @font-face.
    const fcLines = execSync(`fc-list --format="%{postscriptname}\t%{family}\t%{file}\n"`, { timeout: 5000 })
      .toString().split("\n");

    const match = fcLines.find((l) => l.startsWith(postScriptName + "\t"));
    if (!match) return null;

    const [, family] = match.split("\t");

    return { family, size: isNaN(size) ? 12 : size, files: [] };
  } catch {
    return null;
  }
});

// ── Claude Sessions IPC ───────────────────────────────────────────────────────
ipcMain.handle("claude:list-sessions", () => {
  try {
    if (!fs.existsSync(claudeSessionsDir)) return [];
    return fs
      .readdirSync(claudeSessionsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const stat = fs.statSync(join(claudeSessionsDir, f));
        return { filename: f, size: stat.size, lastModified: stat.mtimeMs };
      })
      .sort((a, b) => b.lastModified - a.lastModified);
  } catch {
    return [];
  }
});

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}


// ── Claude Agents IPC ─────────────────────────────────────────────────────────
interface ClaudeAgent {
  name: string;
  description: string;
  model?: string;
  color?: string;
  tools: string[];
  filename: string;
}

ipcMain.handle("claude:list-agents", (): ClaudeAgent[] => {
  try {
    if (!fs.existsSync(claudeAgentsDir)) return [];
    return fs.readdirSync(claudeAgentsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const content = fs.readFileSync(join(claudeAgentsDir, f), "utf8");
        const fm = content.match(/^---\n([\s\S]*?)\n---/);
        let name = f.replace(".md", "");
        let description = "";
        let model: string | undefined;
        let color: string | undefined;
        const tools: string[] = [];
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
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
});

interface ClaudeCommand { name: string; description: string; filename: string; }
interface ClaudeSkill { name: string; description: string; }
interface ClaudeHook { event: string; matcher?: string; command: string; }

/** Parse `description:` from YAML frontmatter, handling inline, `>`, and `|` block scalars. */
function parseFmDescription(yaml: string): string {
  const m = yaml.match(/^description:\s*(.*)/m);
  if (!m) return "";
  const inline = m[1].trim();
  // Inline value (not a block scalar indicator)
  if (inline && inline !== ">" && inline !== "|") return inline;
  // Block scalar: collect subsequent indented lines
  const afterKey = yaml.slice(yaml.indexOf(m[0]) + m[0].length);
  const lines = afterKey.split("\n");
  const indented: string[] = [];
  for (const line of lines) {
    if (line === "") { indented.push(""); continue; }
    if (/^\s+/.test(line)) indented.push(line.trim());
    else break;
  }
  return indented.join(" ").replace(/\s+/g, " ").trim();
}

ipcMain.handle("claude:list-commands", (): ClaudeCommand[] => {
  try {
    if (!fs.existsSync(claudeCommandsDir)) return [];
    return fs.readdirSync(claudeCommandsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const content = fs.readFileSync(join(claudeCommandsDir, f), "utf8");
        const fm = content.match(/^---\n([\s\S]*?)\n---/);
        let description = "";
        if (fm) {
          description = parseFmDescription(fm[1]);
        }
        if (!description) {
          // fallback: first non-empty line after frontmatter
          const body = fm ? content.slice(content.indexOf("---", 3) + 3) : content;
          description = body.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").trim() ?? "";
        }
        return { name: f.replace(".md", ""), description, filename: f };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
});

ipcMain.handle("claude:list-skills", (): ClaudeSkill[] => {
  try {
    if (!fs.existsSync(claudeSkillsDir)) return [];
    return fs.readdirSync(claudeSkillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const skillFile = join(claudeSkillsDir, d.name, "SKILL.md");
        let description = "";
        try {
          const content = fs.readFileSync(skillFile, "utf8");
          const fm = content.match(/^---\n([\s\S]*?)\n---/);
          if (fm) {
            description = parseFmDescription(fm[1]);
          }
          if (!description) {
            const body = fm ? content.slice(content.indexOf("---", 3) + 3) : content;
            description = body.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").trim() ?? "";
          }
        } catch { /* ignore */ }
        return { name: d.name, description };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
});

ipcMain.handle("claude:get-panel-sessions", (_, panelNumber: number): ClaudeSessionEntry[] => {
  return state.panelClaudeSessions[panelNumber] ?? [];
});

ipcMain.handle("claude:get-all-panel-sessions", (): Record<number, ClaudeSessionEntry[]> => {
  return state.panelClaudeSessions ?? {};
});

ipcMain.handle("claude:hook-status", (): { scriptPath: string; installed: boolean; taskScriptPath: string; taskInstalled: boolean } => {
  const settingsPath = join(os.homedir(), ".claude", "settings.json");
  let installed = false;
  let taskInstalled = false;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    for (const entry of (settings.hooks?.SessionStart ?? []) as { hooks?: { command?: string }[] }[]) {
      for (const h of entry.hooks ?? []) {
        if (h.command && h.command.includes("claude-sessionstart-hook.sh")) {
          installed = true;
        }
      }
    }
    for (const entry of (settings.hooks?.PostToolUse ?? []) as { matcher?: string; hooks?: { command?: string }[] }[]) {
      const hasScript = (entry.hooks ?? []).some((h) => h.command?.includes("claude-posttooluse-hook.sh"));
      // Require the current matcher too — a stale install re-shows the "Update task capture" banner.
      if (hasScript && entry.matcher === TASK_HOOK_MATCHER) taskInstalled = true;
    }
  } catch {}
  return { scriptPath: claudeHookScript, installed, taskScriptPath: claudeTaskHookScript, taskInstalled };
});

ipcMain.handle("claude:install-hook", (): { ok: boolean; error?: string } => {
  try {
    ensureClaudeHookScript();
    const settingsPath = join(os.homedir(), ".claude", "settings.json");
    let settings: { hooks?: Record<string, { matcher?: string; hooks?: { type?: string; command: string }[] }[]> } = {};
    try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
    settings.hooks = settings.hooks ?? {};
    settings.hooks.SessionStart = settings.hooks.SessionStart ?? [];
    const already = settings.hooks.SessionStart.some((e) =>
      (e.hooks ?? []).some((h) => h.command?.includes("claude-sessionstart-hook.sh"))
    );
    if (!already) {
      settings.hooks.SessionStart.push({
        hooks: [{ type: "command", command: claudeHookScript }],
      });
      try { fs.copyFileSync(settingsPath, settingsPath + ".bak"); } catch {}
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("claude:install-task-hook", (): { ok: boolean; error?: string } => {
  try {
    ensureClaudeTaskHookScript();
    const settingsPath = join(os.homedir(), ".claude", "settings.json");
    let settings: { hooks?: Record<string, { matcher?: string; hooks?: { type?: string; command: string }[] }[]> } = {};
    try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch {}
    settings.hooks = settings.hooks ?? {};
    settings.hooks.PostToolUse = settings.hooks.PostToolUse ?? [];
    const ours = settings.hooks.PostToolUse.find((e) =>
      (e.hooks ?? []).some((h) => h.command?.includes("claude-posttooluse-hook.sh"))
    );
    // Append when absent; otherwise self-heal a stale matcher in place. Never touch the sibling Bash matcher.
    let changed = false;
    if (!ours) {
      settings.hooks.PostToolUse.push({
        matcher: TASK_HOOK_MATCHER,
        hooks: [{ type: "command", command: claudeTaskHookScript }],
      });
      changed = true;
    } else if (ours.matcher !== TASK_HOOK_MATCHER) {
      ours.matcher = TASK_HOOK_MATCHER;
      changed = true;
    }
    if (changed) {
      try { fs.copyFileSync(settingsPath, settingsPath + ".bak"); } catch {}
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("claude:get-all-tasks", (): TaskSummary[] => {
  return Object.values(state.claudeTaskSessions ?? {}).map(summarizeTaskSession);
});

ipcMain.handle("claude:get-panel-tasks", (_, panelNumber: number): TaskSummary[] => {
  return Object.values(state.claudeTaskSessions ?? {})
    .filter((s) => s.panelNumber === panelNumber)
    .map(summarizeTaskSession);
});

// ── Manual tasks (one global list, created lazily; exempt from pruning) ────────
const MANUAL_KEY = "manual:global";
function manualGroup(create: boolean): ClaudeTaskSession | undefined {
  let s = state.claudeTaskSessions[MANUAL_KEY];
  if (!s && create) {
    s = { claudeSessionId: MANUAL_KEY, panelNumber: null, cwd: "", source: "manual", tasks: {}, order: [], startedAt: Date.now(), updatedAt: Date.now() };
    state.claudeTaskSessions[MANUAL_KEY] = s;
  }
  return s;
}

ipcMain.handle("claude:add-manual-task", (_, subject: string): TaskSummary | null => {
  const text = String(subject ?? "").trim();
  if (!text) return null;
  const s = manualGroup(true)!;
  const id = `mt-${Date.now()}`;
  s.tasks[id] = { id, subject: text, status: "pending", updatedAt: Date.now() };
  s.order.push(id);
  s.updatedAt = Date.now();
  saveState(state);
  const summary = summarizeTaskSession(s);
  send("terminal:claude-tasks-updated", summary);
  return summary;
});

ipcMain.handle("claude:toggle-manual-task", (_, taskId: string): TaskSummary | null => {
  const s = manualGroup(false);
  const t = s?.tasks[taskId];
  if (!s || !t) return null;
  t.status = t.status === "completed" ? "pending" : "completed";
  t.updatedAt = Date.now();
  s.updatedAt = Date.now();
  saveState(state);
  const summary = summarizeTaskSession(s);
  send("terminal:claude-tasks-updated", summary);
  return summary;
});

ipcMain.handle("claude:remove-manual-task", (_, taskId: string): TaskSummary | null => {
  const s = manualGroup(false);
  if (!s || !s.tasks[taskId]) return null;
  delete s.tasks[taskId];
  s.order = s.order.filter((x) => x !== taskId);
  s.updatedAt = Date.now();
  saveState(state);
  const summary = summarizeTaskSession(s);
  send("terminal:claude-tasks-updated", summary);
  return summary;
});

// Delete the index-th todo item from its *todo.md file. index = order of GitHub task lines,
// matching applyTodoFile's f<i> ids. applyTodoFile refreshes state + notifies the UI.
ipcMain.handle("claude:delete-todo-file-item", (_, filePath: string, index: number): boolean => {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    let seen = -1, target = -1;
    for (let i = 0; i < lines.length; i++) {
      if (TODO_ITEM_RE.test(lines[i]) && ++seen === index) { target = i; break; }
    }
    if (target === -1) return false;
    lines.splice(target, 1);
    fs.writeFileSync(filePath, lines.join("\n"));
    if (!applyTodoFile(filePath)) dropTodoFileGroup(filePath);
    return true;
  } catch (e) { console.error("[todo-delete] failed:", e); return false; }
});

// Delete every completed ("- [x]") task line from a *todo.md in one rewrite. Returns count removed.
ipcMain.handle("claude:clear-completed-todo-file-items", (_, filePath: string): number => {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    const kept = lines.filter((l) => { const m = TODO_ITEM_RE.exec(l); return !(m && m[1] !== " "); });
    const removed = lines.length - kept.length;
    if (removed === 0) return 0;
    fs.writeFileSync(filePath, kept.join("\n"));
    if (!applyTodoFile(filePath)) dropTodoFileGroup(filePath);
    return removed;
  } catch (e) { console.error("[todo-clear] failed:", e); return 0; }
});

// Manual rescan trigger for the Tasks drawer ↻ button. Returns the number of todo.md files registered.
ipcMain.handle("claude:rescan-todo-files", async (): Promise<number> => {
  try { return await scanTodoFiles(); }
  catch (e) { console.error("[todo-scan] rescan failed:", e); return 0; }
});

ipcMain.handle("claude:list-hooks", (): ClaudeHook[] => {
  try {
    const settingsPath = join(os.homedir(), ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const result: ClaudeHook[] = [];
    for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
      for (const entry of entries as { matcher?: string; hooks?: { command?: string }[] }[]) {
        for (const h of entry.hooks ?? []) {
          if (h.command) result.push({ event, matcher: entry.matcher, command: h.command });
        }
      }
    }
    return result;
  } catch { return []; }
});

// ── Linear integration (via claude CLI + Linear MCP) ─────────────────────────
interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number; // 0=none 1=urgent 2=high 3=medium 4=low
  state: { name: string; type: string; color: string };
  team: { name: string };
  url: string;
  updatedAt: string;
}
interface LinearState { issues: LinearIssue[]; lastSyncedAt: number | null; error: string | null }

function loadLinearIssues(): LinearState {
  try { return JSON.parse(fs.readFileSync(linearIssuesFile, "utf8")); }
  catch { return { issues: [], lastSyncedAt: null, error: null }; }
}
function saveLinearIssues(s: LinearState) {
  fs.writeFileSync(linearIssuesFile, JSON.stringify(s));
}

let _claudeBin: string | null = null;
// Resolve claude's absolute path once via login shell — handles nvm/local installs.
function resolveClaudeBin(): string {
  if (_claudeBin) return _claudeBin;
  const candidates = [
    `${os.homedir()}/.local/bin/claude`,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  for (const p of candidates) { if (fs.existsSync(p)) { _claudeBin = p; return p; } }
  try {
    _claudeBin = execSync("zsh -lc 'which claude'", { encoding: "utf8", timeout: 5000 }).trim();
    return _claudeBin;
  } catch { return "claude"; }
}

// Sentinel for a killed sync (app shutdown/restart/timeout) — distinct from a real fetch failure.
const SYNC_ABORTED = "__sync_aborted__";

// Calls claude CLI which proxies through the Linear MCP connector — no separate API key needed.
function fetchLinearViaClaude(): Promise<LinearIssue[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveClaudeBin(), [
      "-p",
      'Use Linear to list all issues assigned to me. Exclude completed and cancelled. Return ONLY a raw JSON array — no markdown fences, no explanation. Each element: {"id":"...","identifier":"...","title":"...","priority":0,"state":{"name":"...","type":"...","color":"..."},"team":{"name":"..."},"url":"...","updatedAt":"..."}',
      // Pre-approve Linear MCP tools: headless `claude -p` can't answer permission prompts,
      // so an unlisted tool call is blocked and it returns prose instead of the JSON array.
      "--allowedTools",
      "mcp__claude_ai_Linear,mcp__claude_ai_Linear__list_issues,mcp__linear,mcp__linear__list_issues",
    ], { env: TOOL_ENV, timeout: 300000, stdio: ["ignore", "pipe", "pipe"] }); // ignore stdin (skip claude's 3s wait); 300s: sync is ~130-150s + high variance, so 180s SIGTERM-killed it → 143

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { console.error("[linear-sync]", chunk.toString()); });

    proc.on("close", (code: number | null, signal: string | null) => {
      // Killed (shutdown/restart/timeout SIGTERMs claude → exit 143) — flag so we keep cached issues.
      if (code === 143 || code === null || signal) { reject(new Error(SYNC_ABORTED)); return; }
      if (code !== 0) { reject(new Error(`claude exited ${code}`)); return; }
      const m = stdout.match(/\[[\s\S]*\]/);
      if (!m) { reject(new Error("No JSON array in claude output")); return; }
      try { resolve(JSON.parse(m[0])); } catch (e) { reject(e); }
    });
    proc.on("error", reject);
  });
}

async function syncLinear(): Promise<LinearState> {
  try {
    const issues = await fetchLinearViaClaude();
    const s: LinearState = { issues, lastSyncedAt: Date.now(), error: null };
    saveLinearIssues(s);
    send("linear:issues-updated", s);
    return s;
  } catch (e) {
    const current = loadLinearIssues();
    // Aborted (killed on shutdown/restart) — keep last-good state, don't persist a spurious error.
    if (e instanceof Error && e.message === SYNC_ABORTED) return current;
    const s: LinearState = { ...current, error: e instanceof Error ? e.message : String(e) };
    saveLinearIssues(s);
    send("linear:issues-updated", s);
    return s;
  }
}

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

ipcMain.handle("linear:get-issues", () => loadLinearIssues());
ipcMain.handle("linear:sync", async () => syncLinear());

// ── PRs IPC ───────────────────────────────────────────────────────────────────
interface PRNode {
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
}

ipcMain.handle("prs:delete-branch", async (_, repo: string, branches: string[]): Promise<{ deleted: string[]; failed: { branch: string; reason: string }[] }> => {
  const repoPath = join(githubDir, repo);
  const deleted: string[] = [];
  const failed: { branch: string; reason: string }[] = [];

  for (const branch of branches) {
    try {
      await execAsync(`git branch -D "${branch}"`, { cwd: repoPath, env: TOOL_ENV });
      deleted.push(branch);
    } catch (e: unknown) {
      failed.push({ branch, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { deleted, failed };
});

ipcMain.handle("prs:cleanup-merged", async (_, repo: string): Promise<{ deleted: string[]; failed: { branch: string; reason: string }[] }> => {
  const repoPath = join(githubDir, repo);
  const skipBranches = new Set(["main", "master", "develop", "dev", "HEAD"]);

  const deleted: string[] = [];
  const failed: { branch: string; reason: string }[] = [];
  try {
    // Resolve the remote default branch — try multiple strategies
    let defaultRef = "";
    for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
      try {
        await execAsync(`git rev-parse --verify "${candidate}"`, { cwd: repoPath, env: TOOL_ENV });
        defaultRef = candidate;
        break;
      } catch {}
    }
    if (!defaultRef) return { deleted: [], failed: [{ branch: "", reason: "Could not determine default branch" }] };
    const { stdout } = await execAsync(`git branch --merged "${defaultRef}"`, { cwd: repoPath, env: TOOL_ENV });
    const merged = stdout.split("\n")
      .map((b) => b.trim().replace(/^\*\s*/, ""))
      .filter((b) => b && !skipBranches.has(b));
    for (const branch of merged) {
      try {
        await execAsync(`git branch -d "${branch}"`, { cwd: repoPath, env: TOOL_ENV });
        deleted.push(branch);
      } catch (e: unknown) {
        failed.push({ branch, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch {}
  return { deleted, failed };
});

ipcMain.handle("prs:list-local-branches", async (): Promise<{ repo: string; branch: string; repoUrl: string }[]> => {
  const results: { repo: string; branch: string; repoUrl: string }[] = [];
  const skipBranches = new Set(["HEAD"]);

  try {
    for (const dir of fs.readdirSync(githubDir)) {
      const repoPath = join(githubDir, dir);
      try {
        if (!fs.statSync(repoPath).isDirectory()) continue;
        const gitEntry = join(repoPath, ".git");
        if (!fs.existsSync(gitEntry)) continue;
        // Worktrees have .git as a file pointing back to the main repo — skip them
        if (!fs.statSync(gitEntry).isDirectory()) continue;
        const [branchOut, remoteBranchOut, remoteOut] = await Promise.all([
          execAsync(`git branch --format="%(refname:short)"`, { cwd: repoPath, env: TOOL_ENV }),
          execAsync(`git branch -r --format="%(refname:short)"`, { cwd: repoPath, env: TOOL_ENV }).catch(() => ({ stdout: "" })),
          execAsync(`git remote get-url origin`, { cwd: repoPath, env: TOOL_ENV }).catch(() => ({ stdout: "" })),
        ]);
        const rawUrl = remoteOut.stdout.trim();
        const match = rawUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
        const repoUrl = match ? `https://github.com/${match[1]}` : "";
        const seen = new Set<string>();
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
      } catch {}
    }
  } catch {}
  return results;
});

ipcMain.handle("prs:check-worktree", async (_, repoName: string, branchName: string): Promise<{ exists: boolean; path: string | null }> => {
  try {
    const repoPath = join(os.homedir(), "Documents", "GitHub", repoName);
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

ipcMain.handle("claude-worktrees:list", async (): Promise<{ repo: string; branch: string; path: string; merged: boolean }[]> => {
  const results: { repo: string; branch: string; path: string; merged: boolean }[] = [];

  try {
    for (const dir of fs.readdirSync(githubDir)) {
      const repoPath = join(githubDir, dir);
      try {
        if (!fs.statSync(repoPath).isDirectory()) continue;
        const gitEntry = join(repoPath, ".git");
        if (!fs.existsSync(gitEntry) || !fs.statSync(gitEntry).isDirectory()) continue;
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
            } catch { /* not merged */ }
          }
          results.push({ repo: dir, branch, path: wtPath, merged });
        }
      } catch {}
    }
  } catch {}
  return results;
});

ipcMain.handle("claude-worktrees:remove", async (_, repoName: string, wtPath: string): Promise<void> => {

  const repoPath = join(githubDir, repoName);
  try {
    await execAsync(`git worktree remove --force "${wtPath}"`, { cwd: repoPath, env: TOOL_ENV });
  } catch {
    try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch {}
  }
});

ipcMain.handle("git:check-dirty", async (_, repoName: string): Promise<{ dirty: boolean; files: string[] }> => {
  try {
    const repoPath = join(os.homedir(), "Documents", "GitHub", repoName);
    const { stdout } = await execAsync("git status --porcelain", { cwd: repoPath });
    const files = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    return { dirty: files.length > 0, files };
  } catch {
    return { dirty: false, files: [] };
  }
});

ipcMain.handle("gh:current-user", async (): Promise<string | null> => {
  try {
    const { stdout } = await execAsync("gh api user --jq .login", { env: TOOL_ENV, timeout: 8000 });
    return stdout.trim() || null;
  } catch { return null; }
});

// Teams you're actually on, as `org/slug` — needs the token's `read:org` scope.
async function fetchMyTeams(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `gh api user/teams --paginate --jq '.[] | "\\(.organization.login)/\\(.slug)"'`,
      { env: TOOL_ENV, timeout: 20000 }
    );
    return [...new Set(stdout.trim().split("\n").filter(Boolean))];
  } catch {
    return [];
  }
}

ipcMain.handle("gh:my-teams", fetchMyTeams);

// Shared by the repo fan-out and by hydration so cached and hydrated PRs are interchangeable.
const PR_JSON_FIELDS =
  "number,title,url,headRefName,headRefOid,isDraft,createdAt,updatedAt,reviewDecision," +
  "author,additions,deletions,reviewRequests,statusCheckRollup,mergeable,mergeStateStatus";

// Qualifiers must be gh *flags*: `gh search prs -- "a:b c:d"` quotes the whole string as one term.
const PR_VIEW_FLAGS: Record<string, string> = {
  authored: "--author=@me",
  assigned: "--assignee=@me",
  involves: "--involves=@me",
  reviewRequested: "--review-requested=@me",
};

// Identity only — `gh search prs --json` can't return headRef/CI/diff fields, so the caller hydrates.
// Deliberately not caught: a swallowed 403 secondary-rate-limit reads as "no PRs", which hid it before.
ipcMain.handle("prs:search-refs", async (_, view: string): Promise<{ nameWithOwner: string; number: number }[]> => {
  const flag = PR_VIEW_FLAGS[view];
  if (!flag) throw new Error(`Unknown PR view: ${view}`);
  try {
    const { stdout } = await execAsync(
      `gh search prs ${flag} --state=open --limit 100 --json repository,number`,
      { env: TOOL_ENV, timeout: 20000 }
    );
    const rows = JSON.parse(stdout) as { repository: { nameWithOwner: string }; number: number }[];
    return rows.map((r) => ({ nameWithOwner: r.repository.nameWithOwner, number: r.number }));
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || (err as Error).message || "GitHub search failed");
  }
});

// Fills refs the renderer couldn't satisfy from the fan-out cache — works for repos with no local clone.
ipcMain.handle("prs:hydrate", async (_, refs: { nameWithOwner: string; number: number }[]): Promise<PRNode[]> => {
  if (!refs?.length) return [];
  const results = await Promise.all(
    refs.map(({ nameWithOwner, number }) =>
      execAsync(
        `gh pr view ${number} --repo "${nameWithOwner}" --json ${PR_JSON_FIELDS}`,
        { env: TOOL_ENV, timeout: 20000 }
      )
        .then(({ stdout }) => ({
          ...(JSON.parse(stdout) as Omit<PRNode, "repository">),
          repository: { name: nameWithOwner.split("/").pop() ?? nameWithOwner, nameWithOwner },
        }))
        .catch(() => null)
    )
  );
  return results.filter((pr): pr is PRNode => pr !== null);
});

ipcMain.handle("prs:list", async (_, repoNames: string[]): Promise<PRNode[]> => {
  try {
    if (!repoNames || repoNames.length === 0) return [];

    const repoInfos: { name: string; nameWithOwner: string }[] = [];
    for (const name of repoNames) {
      const repoPath = join(githubDir, name);
      try {
        if (!fs.existsSync(join(repoPath, ".git"))) continue;
        const { stdout } = await execAsync("git remote get-url origin", { cwd: repoPath, env: TOOL_ENV }).catch(() => ({ stdout: "" }));
        const match = stdout.trim().match(/github\.com[/:](.+?)(?:\.git)?$/);
        if (match) repoInfos.push({ name, nameWithOwner: match[1] });
      } catch { continue; }
    }

    const results = await Promise.all(
      repoInfos.map(({ name, nameWithOwner }) =>
        execAsync(
          `gh pr list --repo "${nameWithOwner}" --state open --limit 100 --json ${PR_JSON_FIELDS}`,
          { env: TOOL_ENV, timeout: 20000 }
        ).then(({ stdout }) => {
          const prs = JSON.parse(stdout) as Omit<PRNode, "repository">[];
          return prs.map(pr => ({ ...pr, repository: { name, nameWithOwner } }));
        }).catch(() => [] as PRNode[])
      )
    );

    return results.flat();
  } catch {
    return [];
  }
});

ipcMain.handle("prs:get-diff", async (_, repoName: string, prNumber: number): Promise<string> => {
  const repoPath = join(githubDir, repoName);
  try {
    const { stdout } = await execAsync(`gh pr diff ${prNumber}`, { cwd: repoPath, env: TOOL_ENV });
    return stdout;
  } catch {
    return "";
  }
});

ipcMain.handle("ci:get-status", async (_, repoNameWithOwner: string, prNumber: number) => {
  try {
    const { stdout } = await execAsync(
      `gh pr view ${prNumber} --repo "${repoNameWithOwner}" --json statusCheckRollup`,
      { env: TOOL_ENV, timeout: 15000 }
    );
    return (JSON.parse(stdout).statusCheckRollup ?? []);
  } catch {
    return [];
  }
});

ipcMain.handle("shell:open-external", (_, url: string) => {
  shell.openExternal(url);
});

ipcMain.handle("shell:open-folder", (_, repoOrPath: string) => {
  shell.openPath(resolveRoot(repoOrPath));
});

const TREE_HIDDEN = new Set(["node_modules", "out", "build", "dist", ".gradle", ".cache", ".next", ".nuxt", "__pycache__", ".turbo", ".DS_Store"]);

// Recursive walks only: dirs that are cheap to browse lazily but ruinous to enumerate from $HOME
const WALK_SKIP = new Set([...TREE_HIDDEN, ".git", "Library", ".Trash", ".npm", ".rustup", ".cargo", ".m2", ".pyenv", ".nvm", ".docker", ".ollama"]);
const WALK_LIMIT = 50_000;

// A bare name resolves under ~/Documents/GitHub; an absolute or ~-prefixed root is used as-is
function resolveRoot(repoOrPath: string): string {
  if (repoOrPath.startsWith("~")) return join(os.homedir(), repoOrPath.slice(1));
  if (repoOrPath.startsWith("/")) return repoOrPath;
  return join(githubDir, repoOrPath);
}

ipcMain.handle("repo:list-dir", async (_, repoOrPath: string, subdir: string): Promise<{ name: string; isDir: boolean; path: string }[]> => {
  try {
    const base = join(resolveRoot(repoOrPath), subdir);
    const entries = await fs.promises.readdir(base, { withFileTypes: true });
    return entries
      .filter((e) => e.name !== ".git" && !TREE_HIDDEN.has(e.name))
      .map((e) => ({
        name: e.name,
        isDir: entryIsDir(base, e),
        path: subdir ? `${subdir}/${e.name}` : e.name,
      }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
});

// Resolve symlinked dirs too, so linked folders in $HOME still show as navigable.
function entryIsDir(dir: string, e: fs.Dirent): boolean {
  if (e.isDirectory()) return true;
  if (e.isSymbolicLink()) { try { return fs.statSync(join(dir, e.name)).isDirectory(); } catch { return false; } }
  return false;
}

// General filesystem directory browser (Warp-style new-terminal picker). Dirs only.
ipcMain.handle("fs:list-dirs", async (_, inputPath?: string, showHidden?: boolean): Promise<{
  path: string; parent: string | null; home: string; entries: { name: string; path: string; count: number | null }[];
}> => {
  const home = os.homedir();
  let dir = inputPath && inputPath.length ? inputPath : home;
  if (dir.startsWith("~")) dir = join(home, dir.slice(1));
  dir = join(dir); // normalise trailing slash / . / ..
  const parent = dir === "/" ? null : dirname(dir);
  try {
    const raw = await fs.promises.readdir(dir, { withFileTypes: true });
    const dirs = raw
      .filter((e) => entryIsDir(dir, e) && (showHidden || (!e.name.startsWith(".") && e.name !== "__pycache__")))
      .map((e) => ({ name: e.name, path: join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    // Item count per subdir; skip when the list is huge to avoid a file-descriptor storm.
    const doCounts = dirs.length <= 300;
    const entries = await Promise.all(dirs.map(async (d): Promise<{ name: string; path: string; count: number | null }> => {
      if (!doCounts) return { ...d, count: null };
      try { return { ...d, count: (await fs.promises.readdir(d.path)).length }; }
      catch { return { ...d, count: null }; }
    }));
    return { path: dir, parent, home, entries };
  } catch {
    return { path: dir, parent, home, entries: [] };
  }
});

async function walkDir(dir: string, base: string, results: string[] = []): Promise<string[]> {
  if (results.length >= WALK_LIMIT) return results;
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    if (WALK_SKIP.has(e.name)) continue;
    if (results.length >= WALK_LIMIT) break;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) await walkDir(join(dir, e.name), rel, results);
    else results.push(rel);
  }
  return results;
}

ipcMain.handle("repo:list-files", async (_, repoOrPath: string): Promise<string[]> => {
  try {
    return await walkDir(resolveRoot(repoOrPath), "");
  } catch {
    return [];
  }
});

interface GrepHit { file: string; count: number; line: number; preview: string; }

const GREP_DEADLINE_MS = 15_000;

/** Streams grep and kills it once `cap` files are in. A full scan of a large root takes minutes
 *  (~57s under $HOME), and waiting for one meant every such search reported zero matches. */
function grepFiles(root: string, args: string[], cap: number): Promise<{ files: string[]; truncated: boolean; timedOut: boolean }> {
  return new Promise((resolve) => {
    // spawn, not exec — a shell would expand $ and backticks inside the query
    const child = spawn("grep", args, { cwd: root, env: TOOL_ENV });
    const files: string[] = [];
    let carry = "";
    let truncated = false;
    let timedOut = false;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      child.kill("SIGTERM");
      resolve({ files, truncated, timedOut });
    };
    const deadline = setTimeout(() => { timedOut = true; finish(); }, GREP_DEADLINE_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      carry += chunk.toString();
      const lines = carry.split("\n");
      carry = lines.pop() ?? ""; // last piece may be a partial path
      for (const line of lines) {
        if (!line) continue;
        files.push(line.replace(/^\.\//, ""));
        if (files.length >= cap) { truncated = true; finish(); return; }
      }
    });
    child.stdout.on("error", () => { /* EPIPE once we've killed it */ });
    child.on("error", finish); // grep missing or not executable
    child.on("close", () => {
      if (carry.trim()) files.push(carry.trim().replace(/^\.\//, ""));
      finish();
    });
  });
}

// Fixed-string (-F) so the per-file counts computed below can't disagree with grep's file list
ipcMain.handle("repo:grep-matches", async (_, repoOrPath: string, query: string, limit = 40, mode: { caseSensitive?: boolean; regex?: boolean } = {}): Promise<{ hits: GrepHit[]; totalFiles: number; badPattern?: boolean; truncated?: boolean; timedOut?: boolean }> => {
  const { caseSensitive = false, regex = false } = mode;

  // Counts come from this, so it has to agree with the flags handed to grep below
  let matches: (line: string) => boolean;
  if (regex) {
    let re: RegExp;
    try { re = new RegExp(query, caseSensitive ? "" : "i"); } catch { return { hits: [], totalFiles: 0, badPattern: true }; }
    matches = (line) => re.test(line); // no /g — .test must stay stateless across lines
  } else if (caseSensitive) {
    matches = (line) => line.includes(query);
  } else {
    const needle = query.toLowerCase();
    matches = (line) => line.toLowerCase().includes(needle);
  }

  try {
    const root = resolveRoot(repoOrPath);
    // grep -E is POSIX ERE and has no \d\w\s — translate them so candidates aren't lost to the dialect gap
    const pattern = regex ? query.replace(/\\d/g, "[0-9]").replace(/\\w/g, "[_[:alnum:]]").replace(/\\s/g, "[[:space:]]") : query;
    const args = [
      `-rIl${regex ? "E" : "F"}${caseSensitive ? "" : "i"}`,
      ...[...WALK_SKIP].map((d) => `--exclude-dir=${d}`),
      "-e", pattern, ".",
    ];
    // Headroom over the rendered slice so the "N more files" tail is meaningful without a full scan
    const { files, truncated, timedOut } = await grepFiles(root, args, Math.max(limit * 5, 300));

    // Only the rendered slice is read for counts + preview — scanning every hit under $HOME is unbounded
    const hits: GrepHit[] = [];
    for (const file of files.slice(0, limit)) {
      try {
        const full = join(root, file);
        if (fs.statSync(full).size > 2_000_000) continue;
        const lines = fs.readFileSync(full, "utf8").split("\n");
        let count = 0;
        let first = -1;
        for (let i = 0; i < lines.length; i++) {
          if (!matches(lines[i])) continue;
          count++;
          if (first < 0) first = i;
        }
        if (first < 0) continue;
        hits.push({ file, count, line: first + 1, preview: lines[first].replace(/\t/g, "  ").trim().slice(0, 240) });
      } catch { /* the grep list is advisory — an unreadable file just drops out */ }
    }
    return { hits, totalFiles: files.length, truncated, timedOut };
  } catch {
    return { hits: [], totalFiles: 0 };
  }
});

ipcMain.handle("repo:open-file", (_, repoOrPath: string, filePath: string) => {
  shell.openPath(join(resolveRoot(repoOrPath), filePath));
});

ipcMain.handle("repo:read-file", async (_, repoOrPath: string, filePath: string): Promise<string | null> => {
  try {
    return fs.readFileSync(join(resolveRoot(repoOrPath), filePath), "utf8");
  } catch {
    return null; // distinct from an empty file, so the editor can refuse to save over it
  }
});

ipcMain.handle("repo:write-file", async (_, repoOrPath: string, filePath: string, content: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    const root = resolveRoot(repoOrPath);
    const full = resolve(root, filePath);
    // A "../" in filePath must not let a write land outside the root the renderer asked for
    if (full !== root && !full.startsWith(root + sep)) return { ok: false, error: "path escapes the root" };
    // Editing only — a missing file means a stale or mistyped path, not a file to create
    if (!fs.existsSync(full)) return { ok: false, error: "file no longer exists" };
    selfWrite = { path: full, content }; // set before the write so the watcher can't beat us to it
    fs.writeFileSync(full, content, "utf8");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// ── Open-file watch ────────────────────────────────────────────────────────────
// The viewer shows one file at a time, so a single stat-poll watch covers it.
// Polling rather than fs.watch: editors save atomically via rename, which orphans
// an inode watch.
let watchedFile: string | null = null;
/** Our own last write, so the watcher doesn't echo an autosave back as an external edit. */
let selfWrite: { path: string; content: string } | null = null;

function stopWatchingFile() {
  if (!watchedFile) return;
  fs.unwatchFile(watchedFile);
  watchedFile = null;
}

ipcMain.handle("repo:watch-file", (_, repoOrPath: string, filePath: string) => {
  const full = join(resolveRoot(repoOrPath), filePath);
  if (watchedFile === full) return;
  stopWatchingFile();
  watchedFile = full;
  fs.watchFile(full, { interval: 700 }, (curr) => {
    if (curr.nlink === 0) return; // deleted — leave the buffer alone rather than blanking it
    let content: string;
    try {
      content = fs.readFileSync(full, "utf8");
    } catch {
      return;
    }
    if (selfWrite?.path === full && selfWrite.content === content) return;
    mainWindow?.webContents.send("terminal:file-changed", repoOrPath, filePath, content);
  });
});

ipcMain.handle("repo:unwatch-file", () => stopWatchingFile());

ipcMain.handle("repo:open-in-editor", (_, repoOrPath: string, filePath: string, editor: string) => {
  const fullPath = join(resolveRoot(repoOrPath), filePath);
  const appName = editor === "cursor" ? "Cursor" : "Visual Studio Code";
  const proc = spawn("/usr/bin/open", ["-a", appName, fullPath]);
  proc.on("error", (e) => console.error("[open-in-editor] spawn error:", e));
  proc.on("close", (code) => { if (code !== 0) console.error("[open-in-editor] exit", code); });
  proc.unref();
});

ipcMain.handle("repo:show-in-finder", (_, repoOrPath: string, filePath: string) => {
  shell.showItemInFolder(join(resolveRoot(repoOrPath), filePath));
});

ipcMain.handle("git:current-branch", async (_, repoName: string): Promise<string | null> => {
  try {
    const repoPath = join(githubDir, repoName);
    const { stdout } = await execAsync("git branch --show-current", { cwd: repoPath, env: TOOL_ENV });
    return stdout.trim() || null;
  } catch {
    return null;
  }
});

ipcMain.on("git:clone", (event, { url, requestId }: { url: string; requestId: string }) => {
  const repoName = url.replace(/\.git$/, "").split("/").pop() ?? "repo";
  const destPath = join(githubDir, repoName);

  // Already exists as a git repo — nothing to clone, just surface it
  if (fs.existsSync(join(destPath, ".git"))) {
    event.sender.send("git:clone-done", requestId, repoName);
    return;
  }

  const proc = spawn("git", ["clone", "--progress", url, destPath], { env: TOOL_ENV });
  proc.stderr.on("data", (chunk: Buffer) => {
    event.sender.send("git:clone-progress", requestId, chunk.toString());
  });
  proc.stdout.on("data", (chunk: Buffer) => {
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

type WTFileResult = { path: string; filename: string; dir: string; status: string; additions: number; deletions: number };

ipcMain.handle("git:working-tree", async (_, repoName: string): Promise<{ staged: WTFileResult[]; unstaged: WTFileResult[] }> => {
  const repoPath = join(githubDir, repoName);
  try {
    const [statusRes, stagedNumRes, unstagedNumRes] = await Promise.all([
      execAsync("git status --porcelain", { cwd: repoPath, env: TOOL_ENV }),
      execAsync("git diff --numstat --cached", { cwd: repoPath, env: TOOL_ENV }).catch(() => ({ stdout: "" })),
      execAsync("git diff --numstat", { cwd: repoPath, env: TOOL_ENV }).catch(() => ({ stdout: "" })),
    ]);
    const parseNumstat = (raw: string) => {
      const m = new Map<string, { additions: number; deletions: number }>();
      for (const line of raw.trim().split("\n")) {
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        const a = parseInt(parts[0]); const d = parseInt(parts[1]);
        if (!isNaN(a) && !isNaN(d)) m.set(parts[2].trim(), { additions: a, deletions: d });
      }
      return m;
    };
    const stagedNums = parseNumstat(stagedNumRes.stdout);
    const unstagedNums = parseNumstat(unstagedNumRes.stdout);
    const makeFile = (path: string, status: string, nums: { additions: number; deletions: number }): WTFileResult => {
      const segs = path.split("/"); const filename = segs.pop() ?? path; const dir = segs.join("/");
      return { path, filename, dir, status, ...nums };
    };
    const staged: WTFileResult[] = [], unstaged: WTFileResult[] = [];
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
  } catch { return { staged: [], unstaged: [] }; }
});

ipcMain.handle("git:change-count", async (_, repoName: string): Promise<number> => {
  try {
    const { stdout } = await execAsync("git status --porcelain", { cwd: join(githubDir, repoName), env: TOOL_ENV });
    return stdout.trim().split("\n").filter(Boolean).length;
  } catch { return 0; }
});

// One round trip for the status bar. `resolveRoot` so it works for arbitrary roots, not just ~/Documents/GitHub.
ipcMain.handle("git:repo-status", async (_, repoOrPath: string): Promise<{ branch: string; ahead: number; behind: number; changed: number } | null> => {
  const cwd = resolveRoot(repoOrPath);
  try {
    const [branch, status] = await Promise.all([
      execAsync("git rev-parse --abbrev-ref HEAD", { cwd, env: TOOL_ENV, timeout: 5_000 }).then((r) => r.stdout.trim()),
      execAsync("git status --porcelain", { cwd, env: TOOL_ENV, timeout: 5_000 }).then((r) => r.stdout),
    ]);
    // No upstream is normal on a fresh branch — ahead/behind just stay at zero
    const counts = await execAsync("git rev-list --left-right --count @{u}...HEAD", { cwd, env: TOOL_ENV, timeout: 5_000 })
      .then((r) => r.stdout.trim().split(/\s+/).map(Number))
      .catch(() => [0, 0]);
    return {
      branch,
      behind: counts[0] || 0,
      ahead: counts[1] || 0,
      changed: status.trim().split("\n").filter(Boolean).length,
    };
  } catch { return null; }
});

ipcMain.handle("git:file-diff", async (_, repoName: string, filePath: string, staged: boolean): Promise<string> => {
  try {
    const { stdout } = await execAsync(
      `git diff ${staged ? "--cached" : ""} -- "${filePath}"`,
      { cwd: join(githubDir, repoName), env: TOOL_ENV }
    );
    return stdout;
  } catch { return ""; }
});

ipcMain.handle("git:stage-file", async (_, repoName: string, filePath: string) => {
  await execAsync(`git add -- "${filePath}"`, { cwd: join(githubDir, repoName), env: TOOL_ENV });
});
ipcMain.handle("git:unstage-file", async (_, repoName: string, filePath: string) => {
  await execAsync(`git restore --staged -- "${filePath}"`, { cwd: join(githubDir, repoName), env: TOOL_ENV });
});
ipcMain.handle("git:stage-all", async (_, repoName: string) => {
  await execAsync("git add -A", { cwd: join(githubDir, repoName), env: TOOL_ENV });
});
ipcMain.handle("git:unstage-all", async (_, repoName: string) => {
  await execAsync("git restore --staged .", { cwd: join(githubDir, repoName), env: TOOL_ENV });
});
ipcMain.handle("git:discard-unstaged", async (_, repoName: string) => {
  await execAsync("git restore .", { cwd: join(githubDir, repoName), env: TOOL_ENV }).catch(() => {});
});
ipcMain.handle("git:commit", async (_, repoName: string, message: string) => {
  await execAsync(`git commit -m ${JSON.stringify(message)}`, { cwd: join(githubDir, repoName), env: TOOL_ENV });
});

interface CommitEntry { hash: string; subject: string; author: string; date: string; isMerge: boolean; additions: number; deletions: number; isLocal: boolean; }

ipcMain.handle("git:commits", async (_, repoName: string, headRefName: string, prNumber?: number): Promise<CommitEntry[]> => {
  const repoPath = join(githubDir, repoName);

  // Helper: compute numstat additions/deletions for a commit hash from local git
  const localStats = async (hash: string): Promise<{ additions: number; deletions: number }> => {
    try {
      const { stdout } = await execAsync(`git show --numstat --format="" ${hash}`, { cwd: repoPath, env: TOOL_ENV });
      let additions = 0, deletions = 0;
      for (const line of stdout.trim().split("\n")) {
        const cols = line.split("\t");
        if (cols.length < 2) continue;
        const a = parseInt(cols[0]), d = parseInt(cols[1]);
        if (!isNaN(a)) additions += a;
        if (!isNaN(d)) deletions += d;
      }
      return { additions, deletions };
    } catch { return { additions: 0, deletions: 0 }; }
  };

  // If no prNumber given, try to find one via gh pr list for this branch
  if (!prNumber && headRefName) {
    try {
      const { stdout } = await execAsync(
        `gh pr list --head "${headRefName}" --json number --jq '.[0].number'`,
        { cwd: repoPath, env: TOOL_ENV }
      );
      const n = parseInt(stdout.trim(), 10);
      if (!isNaN(n)) prNumber = n;
    } catch {}
  }

  // Primary: use gh pr view when we have a prNumber — works even if branch is deleted
  if (prNumber) {
    try {
      const { stdout } = await execAsync(
        `gh pr view ${prNumber} --json commits --jq '.commits[] | [.oid, .messageHeadline, (.authors[0].name // ""), .committedDate[0:10], (if (.parents | length) > 1 then "merge" else "" end)] | join("|||")'`,
        { cwd: repoPath, env: TOOL_ENV }
      );
      const commits: CommitEntry[] = [];
      for (const line of stdout.trim().split("\n").filter(Boolean)) {
        const parts = line.split("|||");
        if (parts.length < 4) continue;
        const [hash, subject, author, date, mergeFlag = ""] = parts;
        const isMerge = mergeFlag === "merge";
        const stats = await localStats(hash.trim());
        commits.push({ hash: hash.trim(), subject: subject.trim(), author: author.trim(), date: date.trim(), isMerge, isLocal: false, ...stats });
      }
      if (commits.length > 0) return commits;
    } catch {}
  }

  // Fallback: git log (works when branch still exists on remote)
  try {
    await execAsync(`git fetch origin ${headRefName}`, { cwd: repoPath, env: TOOL_ENV }).catch(() => {});
    let base = "origin/main";
    try {
      const { stdout: symRef } = await execAsync(`git symbolic-ref refs/remotes/origin/HEAD`, { cwd: repoPath, env: TOOL_ENV });
      base = symRef.trim().replace("refs/remotes/", "");
    } catch {
      for (const candidate of ["origin/main", "origin/master"]) {
        try { await execAsync(`git rev-parse ${candidate}`, { cwd: repoPath, env: TOOL_ENV }); base = candidate; break; } catch {}
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
    const pushedHashes = new Set<string>();
    try {
      const { stdout: pushed } = await execAsync(`git log origin/${headRefName} --format=%H`, { cwd: repoPath, env: TOOL_ENV });
      for (const h of pushed.trim().split("\n").filter(Boolean)) pushedHashes.add(h.trim());
    } catch {}
    const commits: CommitEntry[] = [];
    for (const chunk of rawOut.split(SEP).filter(Boolean)) {
      const lines = chunk.trim().split("\n");
      const parts = lines[0].split("|||");
      if (parts.length < 4) continue;
      const [hash, subject, author, date, parents = ""] = parts;
      const isMerge = parents.trim().split(/\s+/).filter(Boolean).length > 1;
      let additions = 0, deletions = 0;
      for (const line of lines.slice(1)) {
        const cols = line.split("\t");
        if (cols.length < 2) continue;
        const a = parseInt(cols[0]), d = parseInt(cols[1]);
        if (!isNaN(a) && !isNaN(d)) { additions += a; deletions += d; }
      }
      commits.push({ hash: hash.trim(), subject: subject.trim(), author: author.trim(), date: date.trim(), isMerge, additions, deletions, isLocal: !pushedHashes.has(hash.trim()) });
    }
    return commits;
  } catch { return []; }
});

ipcMain.handle("git:commit-diff", async (_, repoName: string, hash: string): Promise<string> => {
  try {
    const { stdout } = await execAsync(`git show ${hash}`, { cwd: join(githubDir, repoName), env: TOOL_ENV });
    return stdout;
  } catch { return ""; }
});

ipcMain.handle("github:list-repos", async (): Promise<{ name: string; branches: string[]; repoUrl: string }[]> => {
  const results: { name: string; branches: string[]; repoUrl: string }[] = [];
  const targetBranches = ["main", "dev", "master", "develop"];

  try {
    for (const dir of fs.readdirSync(githubDir)) {
      const repoPath = join(githubDir, dir);
      try {
        if (!fs.statSync(repoPath).isDirectory()) continue;
        const gitEntry = join(repoPath, ".git");
        if (!fs.existsSync(gitEntry)) continue;
        if (!fs.statSync(gitEntry).isDirectory()) continue;
        const [branchOut, remoteOut] = await Promise.all([
          execAsync(`git branch --format="%(refname:short)"`, { cwd: repoPath, env: TOOL_ENV }),
          execAsync(`git remote get-url origin`, { cwd: repoPath, env: TOOL_ENV }).catch(() => ({ stdout: "" })),
        ]);
        const existing = new Set(branchOut.stdout.trim().split("\n").map((b) => b.trim()));
        const branches = targetBranches.filter((b) => existing.has(b));
        if (branches.length === 0) continue;
        const rawUrl = remoteOut.stdout.trim();
        const match = rawUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
        const repoUrl = match ? `https://github.com/${match[1]}` : "";
        results.push({ name: dir, branches, repoUrl });
      } catch {}
    }
  } catch {}
  return results.sort((a, b) => a.name.localeCompare(b.name));
});

// ── Claude File / Process / Memory IPC ───────────────────────────────────────
ipcMain.handle("claude:open-file", (_, filepath: string) => {
  const resolved = filepath.startsWith("~") ? join(os.homedir(), filepath.slice(1)) : filepath;
  shell.openPath(resolved);
});

ipcMain.handle("claude:list-memory-files", (): { path: string; label: string; size: number }[] => {
  const files: { path: string; label: string; size: number }[] = [];
  const globalMem = join(os.homedir(), ".claude", "MEMORY.md");
  if (fs.existsSync(globalMem)) {
    files.push({ path: globalMem, label: "MEMORY.md (global)", size: fs.statSync(globalMem).size });
  }
  if (fs.existsSync(claudeProjectsDir)) {
    try {
      for (const proj of fs.readdirSync(claudeProjectsDir)) {
        const memDir = join(claudeProjectsDir, proj, "memory");
        try {
          if (!fs.existsSync(memDir) || !fs.statSync(memDir).isDirectory()) continue;
          for (const f of fs.readdirSync(memDir)) {
            if (!f.endsWith(".md")) continue;
            const fullPath = join(memDir, f);
            files.push({ path: fullPath, label: `${proj.slice(0, 40)}/${f}`, size: fs.statSync(fullPath).size });
          }
        } catch {}
      }
    } catch {}
  }
  return files;
});

ipcMain.handle("claude:read-memory-file", (_, filepath: string): string => {
  try { return fs.readFileSync(filepath, "utf8"); } catch { return ""; }
});

ipcMain.handle("claude:active-count", async (): Promise<number> => {
  try {
    const { stdout } = await execAsync("pgrep -x claude", { timeout: 2000 });
    return stdout.trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
});

ipcMain.handle("claude:write-to-focused", (_, text: string): void => {
  if (focusedSessionId) sessions.get(focusedSessionId)?.write(text);
});

// ── KB Chat IPC ───────────────────────────────────────────────────────────────

// Strip the grammar-correction block injected by the UserPromptSubmit hook in
// ~/.claude/settings.json. Pattern: ─── Correction ─── / ***text*** / ─────────
function stripCorrectionBlock(text: string): string {
  return text.replace(/^─+[^\n]*\n\*{3}[^*\n]*\*{3}\n─+[^\n]*\n*/, "").trimStart();
}

const chatSessionsFile = join(dataDir, "chat-sessions.json");
const chatSettingsFile = join(dataDir, "chat-settings.json");
const chatProcesses = new Map<string, ChildProcess>();

const DEFAULT_WIKI_DIR = "~/Documents/GitHub/knowledge-base/wiki";

interface ChatSettings { model: string; wikiDir: string; }

function loadChatSettings(): ChatSettings {
  try {
    const s = JSON.parse(fs.readFileSync(chatSettingsFile, "utf8"));
    return { model: "claude-sonnet-4-6", wikiDir: DEFAULT_WIKI_DIR, ...s };
  }
  catch { return { model: "claude-sonnet-4-6", wikiDir: DEFAULT_WIKI_DIR }; }
}

ipcMain.handle("chat:get-settings", () => loadChatSettings());
ipcMain.on("chat:save-settings", (_, data: ChatSettings) => {
  try { fs.writeFileSync(chatSettingsFile, JSON.stringify(data, null, 2)); } catch {}
});
ipcMain.handle("chat:pick-wiki-dir", async (): Promise<string | null> => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
    title: "Choose wiki directory",
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("chat:load-wiki-pages", (): { name: string; content: string }[] => {
  const raw = loadChatSettings().wikiDir;
  const wikiDir = raw.startsWith("~/") ? join(os.homedir(), raw.slice(2)) : raw;
  if (!fs.existsSync(wikiDir)) return [];
  try {
    return fs.readdirSync(wikiDir)
      .filter((f) => f.endsWith(".md") || f.endsWith(".excalidraw"))
      .sort()
      .map((f) => {
        const content = fs.readFileSync(join(wikiDir, f), "utf8");
        if (f.endsWith(".excalidraw")) {
          return {
            name: f.replace(".excalidraw", "") + " (Excalidraw diagram)",
            content: `[Excalidraw diagram — to display it, output the full JSON below wrapped in a \`\`\`excalidraw fenced code block]\n${content}`,
          };
        }
        return { name: f.replace(".md", ""), content };
      });
  } catch { return []; }
});

ipcMain.handle("chat:load-sessions", () => {
  try { return JSON.parse(fs.readFileSync(chatSessionsFile, "utf8")); }
  catch { return []; }
});

ipcMain.on("chat:save-sessions", (_, data: unknown) => {
  try { fs.writeFileSync(chatSessionsFile, JSON.stringify(data, null, 2)); } catch {}
});

ipcMain.on("chat:send", (_, { requestId, message, sessionId, mode, wikiContext, model }: {
  requestId: string;
  message: string;
  sessionId: string | null;
  mode: "kb" | "code";
  wikiContext?: string;
  model?: string;
}) => {
  const claudeEnv = {
    ...process.env,
    PATH: `${join(os.homedir(), ".local", "bin")}:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH ?? ""}`,
  };

  const resolvedModel = model ?? loadChatSettings().model;

  const args: string[] = [
    "--print",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--model", resolvedModel,
  ];

  if (sessionId) {
    args.push("--resume", sessionId);
  } else if (mode === "kb" && wikiContext) {
    args.push("--system-prompt", wikiContext);
  } else if (mode === "code") {
    args.push("--add-dir", join(os.homedir(), "Documents", "GitHub"));
    args.push("--permission-mode", "bypassPermissions");
  }

  const proc = spawn(CLAUDE_BIN, args, { env: claudeEnv, stdio: ["pipe", "pipe", "pipe"] });
  proc.stdin.write(message, "utf8");
  proc.stdin.end();
  chatProcesses.set(requestId, proc);
  let lineBuffer = "";
  let stderrBuffer = "";
  proc.stderr.on("data", (data: Buffer) => { if (stderrBuffer.length < 8192) stderrBuffer += data.toString(); });

  proc.stdout.on("data", (data: Buffer) => {
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
          const content: { type: string; name?: string; text?: string }[] = event.message?.content ?? [];
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
            cacheCreationTokens: event.usage.cache_creation_input_tokens ?? 0,
          });
        }
      } catch { /* ignore malformed lines */ }
    }
  });

  proc.on("close", (code: number | null) => {
    chatProcesses.delete(requestId);
    if (code !== 0 && code !== null) {
      const detail = stderrBuffer.trim();
      send("chat:error", requestId, detail || `claude exited with code ${code}`);
    } else {
      send("chat:done", requestId);
    }
  });
});

ipcMain.on("chat:stop", (_, requestId: string) => {
  const proc = chatProcesses.get(requestId);
  if (proc) {
    proc.kill();
    chatProcesses.delete(requestId);
    send("chat:done", requestId);
  }
});

ipcMain.handle("claude:read-session", (_, filename: string): ClaudeMessage[] => {
  const safe = basename(filename);
  const file = join(claudeSessionsDir, safe);
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const messages: ClaudeMessage[] = [];
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
          text = msg.content
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { text: string }) => b.text)
            .join("");
        }
        if (text.trim()) {
          messages.push({ role: entry.type, content: text, timestamp: entry.timestamp });
        }
      } catch {}
    }
    return messages;
  } catch {
    return [];
  }
});
