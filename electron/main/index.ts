import { app, BrowserWindow, ipcMain } from "electron";
import { join, basename } from "path";
import { createServer } from "http";
import { AddressInfo } from "net";
import { execSync } from "child_process";
import * as fs from "fs";
import * as pty from "node-pty";
import os from "os";

app.name = "Terminal Dashboard";

// ── Paths ────────────────────────────────────────────────────────────────────
const dataDir = join(os.homedir(), ".terminal-dashboard");
const stateFile = join(dataDir, "state.json");
const historyDir = join(dataDir, "history");
const repoStatsFile = join(dataDir, "repo-stats.json");
const claudeSessionsDir = join(os.homedir(), ".claude", "sessions");
const claudeProjectsDir = join(os.homedir(), ".claude", "projects");

fs.mkdirSync(historyDir, { recursive: true });

// ── State ────────────────────────────────────────────────────────────────────
interface SavedPanel {
  number: number;
  title: string;
}
interface AppState {
  terminalCounter: number;
  lastPanels: SavedPanel[];
}

function loadState(): AppState {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return { terminalCounter: 0, lastPanels: [] };
  }
}

function saveState(state: AppState) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// ── Repo Stats ───────────────────────────────────────────────────────────────
interface RepoEntry { visits: number; lastSeen: number }
interface RepoStats { [repo: string]: RepoEntry }

function loadRepoStats(): RepoStats {
  try { return JSON.parse(fs.readFileSync(repoStatsFile, "utf8")); }
  catch { return {}; }
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
  fs.writeFileSync(repoStatsFile, JSON.stringify(stats));
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
  panelNumber?: number
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
    backgroundColor: "#0d1117",
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
  (_, cols: number, rows: number, panelNumber?: number) => {
    return createSession(cols, rows, panelNumber);
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
        return { number: num, size: stat.size, lastModified: stat.mtimeMs };
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
