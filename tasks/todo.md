# Todo


## Review

- **Clear completed todos**: per-file "Clear done" button on each todo.md card in the Tasks drawer, behind a confirm modal. New IPC `claude:clear-completed-todo-file-items` strips all `- [x]` lines in one rewrite. Touched: electron/main/index.ts, electron/preload/index.ts, src/hooks/useTerminal.ts, src/components/TasksDrawer.tsx.
- **Taller change-directory bar**: bumped the terminal panel's bottom status bar padding 2px → 7px (src/components/TerminalPanel.tsx). Verified live via `npm run dev`.
- **Fix: mobile-edge todos vanished after clearing another repo**: root cause was `findTodoFiles` skipping *all* dot-dirs, so `.claude/local/tasks/todo.md` (mobile-edge's real todo file) was undiscoverable by scan/rescan — once its in-memory session was lost on a boot/HMR restart, no rescan could restore it. Fixed by descending into `.claude` while still skipping other dot-dirs (electron/main/index.ts `findTodoFiles`). Verified: after restart the scan re-registers the 73-task file.
