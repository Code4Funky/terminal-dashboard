import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import { join, basename } from "path";
import { createServer } from "http";
import { AddressInfo } from "net";
import { execSync, exec, spawn, type ChildProcess } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
import * as fs from "fs";
import * as pty from "node-pty";
import os from "os";

app.name = "Terminal Dashboard";

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

fs.mkdirSync(historyDir, { recursive: true });

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
}
interface AppState {
  terminalCounter: number;
  lastPanels: SavedPanel[];
  panelTitles: Record<number, string>;
}

function loadState(): AppState {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return { panelTitles: {}, ...s };
  } catch {
    return { terminalCounter: 0, lastPanels: [], panelTitles: {} };
  }
}

function saveState(state: AppState) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
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

function computeClaudeStats(targetMonth?: string) {
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
              if (isThisMonth) {
                monthInputTokens += inp;
                monthOutputTokens += out;
                monthCacheReadTokens += cacheRead;
                monthCacheCreationTokens += cacheCreate;
                if (day in dayTokensInMonth) dayTokensInMonth[day] += inp + out;
                // Per-model accumulation
                const model: string = entry.message?.model ?? "unknown";
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
  };
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

function createSession(
  cols: number,
  rows: number,
  panelNumber?: number,
  initialCommand?: string
): { sessionId: string; number: number } {
  const num = panelNumber ?? ++state.terminalCounter;
  if (!panelNumber) saveState(state);

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
    // Prepend any previously buffered partial OSC sequence
    let buf = (oscBuffers.get(sessionId) ?? "") + rawData;

    // Process all complete OSC 9999 sequences (CWD+git updates), strip them
    const oscRe = /\x1b\]9999;([^\x1c]*)\x1c([^\x07]*)\x07/;
    let m: RegExpMatchArray | null;
    while ((m = oscRe.exec(buf)) !== null) {
      send("terminal:cwd-update", sessionId, m[1], m[2]);
      recordRepoVisit(sessionId, m[1]);
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
    send(`terminal:output:${sessionId}`, buf);
  });

  ptyProcess.onExit(() => {
    oscBuffers.delete(sessionId);
    sessionLastRepo.delete(sessionId);
    histStream.end();
    send(`terminal:exit:${sessionId}`);
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, ptyProcess);

  // Send initial CWD immediately so the panel title bar shows it before precmd fires
  setTimeout(() => send("terminal:cwd-update", sessionId, os.homedir(), ""), 300);

  if (initialCommand) {
    setTimeout(() => ptyProcess.write(initialCommand + "\r"), 1200);
  }

  return { sessionId, number: num };
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

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#000000",
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
  applicationName: "Terminal Dashboard",
  applicationVersion: "0.1.0",
  copyright: "© 2026 Tung Tran <tranthaitung.inbox@gmail.com>",
  iconPath: join(__dirname, "../../build/icons/icon.icns"),
});

app.whenReady().then(() => {
  startHttpServer(); // createWindow() is called inside once zdotdir is ready

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
  (_, panels: { number: number; title: string }[]) => {
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

// ── PRs IPC ───────────────────────────────────────────────────────────────────
interface PRNode {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  headRefOid: string;
  isDraft: boolean;
  createdAt: string;
  reviewDecision: string | null;
  repository: { name: string; nameWithOwner: string };
}

ipcMain.handle("prs:delete-branch", async (_, repo: string, branches: string[]): Promise<{ deleted: string[]; failed: { branch: string; reason: string }[] }> => {
  const repoPath = join(githubDir, repo);
  const deleted: string[] = [];
  const failed: { branch: string; reason: string }[] = [];
  const ghEnv = { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin` };
  for (const branch of branches) {
    try {
      await execAsync(`git branch -D "${branch}"`, { cwd: repoPath, env: ghEnv });
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
  const ghEnv = { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin` };
  const deleted: string[] = [];
  const failed: { branch: string; reason: string }[] = [];
  try {
    // Resolve the remote default branch — try multiple strategies
    let defaultRef = "";
    for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
      try {
        await execAsync(`git rev-parse --verify "${candidate}"`, { cwd: repoPath, env: ghEnv });
        defaultRef = candidate;
        break;
      } catch {}
    }
    if (!defaultRef) return { deleted: [], failed: [{ branch: "", reason: "Could not determine default branch" }] };
    const { stdout } = await execAsync(`git branch --merged "${defaultRef}"`, { cwd: repoPath, env: ghEnv });
    const merged = stdout.split("\n")
      .map((b) => b.trim().replace(/^\*\s*/, ""))
      .filter((b) => b && !skipBranches.has(b));
    for (const branch of merged) {
      try {
        await execAsync(`git branch -d "${branch}"`, { cwd: repoPath, env: ghEnv });
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
  const skipBranches = new Set(["main", "master", "develop", "dev", "HEAD"]);
  const gitEnv = { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin` };
  try {
    for (const dir of fs.readdirSync(githubDir)) {
      const repoPath = join(githubDir, dir);
      try {
        if (!fs.statSync(repoPath).isDirectory()) continue;
        const gitEntry = join(repoPath, ".git");
        if (!fs.existsSync(gitEntry)) continue;
        // Worktrees have .git as a file pointing back to the main repo — skip them
        if (!fs.statSync(gitEntry).isDirectory()) continue;
        const [branchOut, remoteOut] = await Promise.all([
          execAsync(`git branch --format="%(refname:short)"`, { cwd: repoPath, env: gitEnv }),
          execAsync(`git remote get-url origin`, { cwd: repoPath, env: gitEnv }).catch(() => ({ stdout: "" })),
        ]);
        const rawUrl = remoteOut.stdout.trim();
        const match = rawUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
        const repoUrl = match ? `https://github.com/${match[1]}` : "";
        for (const b of branchOut.stdout.trim().split("\n")) {
          const branch = b.trim();
          if (branch && !skipBranches.has(branch)) {
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
  const gitEnv = { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin` };
  try {
    for (const dir of fs.readdirSync(githubDir)) {
      const repoPath = join(githubDir, dir);
      try {
        if (!fs.statSync(repoPath).isDirectory()) continue;
        const gitEntry = join(repoPath, ".git");
        if (!fs.existsSync(gitEntry) || !fs.statSync(gitEntry).isDirectory()) continue;
        const { stdout } = await execAsync("git worktree list", { cwd: repoPath, env: gitEnv });
        for (const line of stdout.split("\n")) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 3) continue;
          const [wtPath, , branchRef] = parts;
          if (!wtPath.includes(`${dir}-worktrees`)) continue;
          const branch = branchRef.replace(/^\[|\]$/g, "");
          let merged = false;
          try {
            await execAsync(`git merge-base --is-ancestor "${branch}" main`, { cwd: repoPath, env: gitEnv });
            merged = true;
          } catch {
            try {
              await execAsync(`git merge-base --is-ancestor "${branch}" master`, { cwd: repoPath, env: gitEnv });
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
  const gitEnv = { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin` };
  const repoPath = join(githubDir, repoName);
  try {
    await execAsync(`git worktree remove --force "${wtPath}"`, { cwd: repoPath, env: gitEnv });
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

ipcMain.handle("prs:list", async (): Promise<PRNode[]> => {
  try {
    const query = `{ viewer { pullRequests(first: 50, states: [OPEN]) { nodes { number title url headRefName headRefOid isDraft createdAt reviewDecision repository { name nameWithOwner } } } } }`;
    const ghEnv = { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin` };
    const { stdout } = await execAsync(`gh api graphql -f query='${query}'`, { env: ghEnv });
    const data = JSON.parse(stdout);
    return data.data?.viewer?.pullRequests?.nodes ?? [];
  } catch {
    return [];
  }
});

ipcMain.handle("shell:open-external", (_, url: string) => {
  shell.openExternal(url);
});

ipcMain.handle("github:list-repos", async (): Promise<{ name: string; branches: string[]; repoUrl: string }[]> => {
  const results: { name: string; branches: string[]; repoUrl: string }[] = [];
  const targetBranches = ["main", "dev", "master", "develop"];
  const gitEnv = { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin` };
  try {
    for (const dir of fs.readdirSync(githubDir)) {
      const repoPath = join(githubDir, dir);
      try {
        if (!fs.statSync(repoPath).isDirectory()) continue;
        const gitEntry = join(repoPath, ".git");
        if (!fs.existsSync(gitEntry)) continue;
        if (!fs.statSync(gitEntry).isDirectory()) continue;
        const [branchOut, remoteOut] = await Promise.all([
          execAsync(`git branch --format="%(refname:short)"`, { cwd: repoPath, env: gitEnv }),
          execAsync(`git remote get-url origin`, { cwd: repoPath, env: gitEnv }).catch(() => ({ stdout: "" })),
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
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => ({ name: f.replace(".md", ""), content: fs.readFileSync(join(wikiDir, f), "utf8") }));
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

  args.push(message);

  const proc = spawn(CLAUDE_BIN, args, { env: claudeEnv });
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
