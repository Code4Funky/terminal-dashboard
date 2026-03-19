# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start dev (Electron + Vite HMR)
npm run build      # compile TS → out/
npm run package    # build + package as macOS .dmg
npm postinstall    # rebuild node-pty for current Electron ABI (run after npm install)
```

There are no tests. TypeScript type-checking is the only static validation:
```bash
npx tsc --noEmit
```

## Architecture

Electron app with three processes:

**Main process** (`electron/main/index.ts`)
- Spawns PTY sessions via `node-pty`, one per panel
- Intercepts OSC `9999` escape sequences from the shell to extract CWD + git branch without a curl roundtrip — strips them from the data stream before forwarding to the renderer
- Runs a local HTTP server on a random port (written to `~/.terminal-dashboard/port`) for shell commands: `POST /new-terminal`, `POST /update-cwd`, `POST /cd`
- Persists panel state + terminal counter to `~/.terminal-dashboard/state.json`; scrollback logs to `~/.terminal-dashboard/history/terminal-<N>.log` (pruned after 30 days)
- On startup, creates a temp `ZDOTDIR` directory injecting a `.zshrc` that sources the user's real `.zshrc`, then registers `precmd`/`chpwd` hooks to emit OSC 9999 and provides `nt`/`new_terminal` aliases and a fuzzy `cd` for `~/Documents/GitHub/`

**Preload** (`electron/preload/index.ts`)
- Exposes `window.terminal` API via `contextBridge` — the only surface for renderer↔main communication
- All IPC channels are prefixed `terminal:`

**Renderer** (`src/`)
- `Dashboard.tsx` — top-level state: panel list, column count, focused session. Manages panel lifecycle (create/restore/close) and listens for CWD updates and shell-spawned panels
- `TerminalPanel.tsx` — renders one xterm.js terminal; title bar shows panel name + CWD + git branch (git branch colored red, `git:(branch)` format)
- `useTerminal.ts` — xterm.js setup, history replay, resize observer, IPC wiring; declares the `Window.terminal` type
- `HistoryDrawer.tsx` — slide-in panel showing past sessions from disk, with reopen/delete

## Technology choices

| Concern | Choice | Why |
|---|---|---|
| App shell | **Electron** | Native PTY access (`node-pty`) requires Node; Electron gives a full Chromium renderer for xterm.js |
| Build tool | **electron-vite** | Vite HMR for the renderer process; handles the three-entry build (main/preload/renderer) with a single config |
| Terminal emulator | **xterm.js** (`@xterm/xterm`) | De-facto standard; `FitAddon` handles resize, `WebLinksAddon` adds clickable URLs |
| PTY | **node-pty** | Only mature cross-platform PTY binding for Node; must be rebuilt per Electron ABI (`electron-rebuild`) |
| CWD/branch signaling | **OSC 9999 escape sequence** | Zero-latency — emitted inline in the terminal data stream, no subprocess or network hop. The main process strips the sequences before they reach xterm so they're invisible to the user |
| Shell integration | **ZDOTDIR injection** | Avoids modifying the user's real dotfiles; a temp dir is created per app launch and cleaned up on quit |
| State persistence | **JSON file** (`~/.terminal-dashboard/state.json`) | Simple; no database dependency. Panel numbers are monotonically increasing and never reused, so history files stay stable |
| Renderer framework | **React 18** (no router, no state lib) | Single-page, no routing needed; `useState`/`useEffect` is sufficient — no Redux/Zustand |
| Styling | **Inline styles** | No CSS framework or CSS modules. All visual state is expressed as JS objects co-located with components |
| IPC boundary | **`contextBridge` + typed `window.terminal`** | `contextIsolation: true`, `nodeIntegration: false` — renderer has no direct Node access; all Node/native calls go through the typed preload API declared in `useTerminal.ts` |

## Key data flows

- **CWD/git updates**: shell `precmd` → `printf "\033]9999;$PWD\034$branch\007"` → main process regex strips it → `terminal:cwd-update` IPC → `Dashboard` state → `TerminalPanel` title bar
- **New panel from shell**: `curl POST /new-terminal` → main creates PTY → `terminal:new-panel` IPC → Dashboard adds panel
- **Focus tracking**: clicking a panel calls `window.terminal.setFocused(sessionId)` → main stores `focusedSessionId` → used by `POST /cd` to target the right session
- **History replay**: on panel mount, `getHistory(panelNumber)` reads last 200 KB of the log file and writes it to xterm before connecting live output

## Environment variables injected into each PTY

- `TERMINAL_DASHBOARD_PORT` — HTTP server port
- `TERMINAL_SESSION_ID` — UUID for the session
- `ZDOTDIR` — temp dir containing the injected `.zshrc`
