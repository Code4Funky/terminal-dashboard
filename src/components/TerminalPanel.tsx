import { useRef, useEffect, useState, memo } from "react";
import type { CSSProperties } from "react";
import { useTerminal } from "../hooks/useTerminal";
import { useTheme } from "../ThemeContext";
import { useSettings } from "../SettingsContext";
import { DirectoryPicker } from "./DirectoryPicker";
import { shellQuote } from "../shell";
import { SYS_FONT, MONO_FONT, TABULAR } from "../theme";
import { rowState, dot, chip, CLIP, CLIP_LEFT, RADIUS, RADIUS_SM, TRANSITION } from "../chrome";
import type { DotState } from "../chrome";
import type { TaskSummary } from "../types/tasks";
import "@xterm/xterm/css/xterm.css";

interface Props {
  id: string;
  sessionId: string | null;
  panelNumber: number | null;
  title: string;
  cwd?: string;
  gitBranch?: string;
  fontFamily?: string;
  fontSize?: number;
  onClose: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onSplit?: (id: string, dir: "row" | "column") => void;
  onFlipAxis?: (id: string) => void;
  /** Axis of the split this pane belongs to; undefined when the pane isn't split. */
  splitDir?: "row" | "column";
  canClose?: boolean;
  canSplit?: boolean;
  focused: boolean;
  onFocus: (id: string) => void;
  fitTrigger?: number;
  broadcast?: boolean;
}

function formatCwd(cwd: string): string {
  const home = "/Users/" + (cwd.split("/")[2] ?? "");
  return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
}

export const TerminalPanel = memo(function TerminalPanel({
  id, sessionId, panelNumber, title, cwd, gitBranch,
  fontFamily, fontSize, onClose, onRename, onSplit, onFlipAxis, splitDir, canClose = true, canSplit = false, focused, onFocus, fitTrigger, broadcast = false,
}: Props) {
  const { theme: t } = useTheme();
  const { settings } = useSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  // Settings override the iTerm2-detected font; fall back to it when unset.
  const effFamily = settings.fontFamily || fontFamily || "MesloLGS NF, Monaco, monospace";
  const effSize = settings.fontSize || fontSize || 13;
  const { focus, refit, searchNext, searchPrevious, clearSearch, onSearchResults, focusTerminal } =
    useTerminal(containerRef, sessionId, panelNumber, effFamily, effSize, true, {
      scrollback: settings.scrollback,
      cursorStyle: settings.cursorStyle,
      cursorBlink: settings.cursorBlink,
      rendererType: settings.rendererType,
      broadcast,
    });
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const [panelHovered, setPanelHovered] = useState(false);
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);
  const [taskSummary, setTaskSummary] = useState<TaskSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState({ resultIndex: -1, resultCount: 0 });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showDirPicker, setShowDirPicker] = useState(false);

  useEffect(() => {
    if (panelNumber === null) return;
    let cancelled = false;
    window.terminal.getPanelClaudeSessions(panelNumber).then((sessions) => {
      if (cancelled || sessions.length === 0) return;
      const latest = sessions.slice().sort((a, b) => b.startedAt - a.startedAt)[0];
      setClaudeSessionId(latest.claudeSessionId);
    });
    const cleanup = window.terminal.onClaudeSessionRecorded((num, sid) => {
      if (num === panelNumber) setClaudeSessionId(sid);
    });
    return () => { cancelled = true; cleanup(); };
  }, [panelNumber]);

  useEffect(() => {
    if (panelNumber === null) return;
    let cancelled = false;
    window.terminal.getPanelTasks(panelNumber).then((list) => {
      if (cancelled || list.length === 0) return;
      setTaskSummary(list.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]);
    });
    const cleanup = window.terminal.onClaudeTasksUpdated((sum) => {
      if (sum.panelNumber === panelNumber) setTaskSummary(sum); // filter → only this panel re-renders
    });
    return () => { cancelled = true; cleanup(); };
  }, [panelNumber]);

  const copyClaudeId = () => {
    if (!claudeSessionId) return;
    navigator.clipboard.writeText(`claude --resume ${claudeSessionId}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  useEffect(() => {
    if (!renaming) setRenameValue(title);
  }, [title, renaming]);

  useEffect(() => {
    if (focused) focus();
  }, [focused]);

  useEffect(() => {
    if (fitTrigger) refit();
  }, [fitTrigger]);

  const commitRename = () => {
    const v = renameValue.trim();
    if (v && v !== title) onRename?.(id, v);
    else setRenameValue(title);
    setRenaming(false);
  };

  // ⌘F opens find — capture phase + stopPropagation so xterm/browser never see it.
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.select());
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [focused]);

  useEffect(() => {
    if (!searchOpen) return;
    const off = onSearchResults(setSearchResults);
    if (searchQuery) searchNext(searchQuery, true); // re-highlight the prior query on reopen
    return off;
  }, [searchOpen]);

  const runSearch = (q: string, incremental: boolean) => {
    if (!q) { clearSearch(); setSearchResults({ resultIndex: -1, resultCount: 0 }); return; }
    searchNext(q, incremental);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    clearSearch();
    focusTerminal();
  };

  const searchBtn: CSSProperties = {
    background: "none", border: "none", color: t.label3,
    cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "2px 6px", borderRadius: RADIUS_SM,
  };

  // Header actions stay hidden until the panel is hovered or focused, so idle panes read clean.
  const headerBtn = (enabled: boolean): CSSProperties => ({
    width: 20, height: 20, flex: "none",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "none", border: "none", borderRadius: RADIUS_SM, color: t.label3,
    cursor: enabled ? "pointer" : "default", fontSize: 13, lineHeight: 1,
    opacity: (panelHovered || focused) && enabled ? 1 : 0,
    pointerEvents: (panelHovered || focused) && enabled ? "auto" : "none",
    transition: TRANSITION,
  });

  // Live only when an agent is actually working — focus is not activity.
  const runState: DotState = taskSummary && taskSummary.inProgress > 0 ? "running" : "idle";

  return (
    <div
      style={{
        position: "relative",
        display: "flex", flexDirection: "column",
        flex: 1,
        border: `1px solid ${t.border}`,
        borderRadius: RADIUS, overflow: "hidden",
        background: t.surface1,
        minHeight: 0,
        transition: TRANSITION,
      }}
      onClick={() => onFocus(id)}
      onMouseEnter={() => setPanelHovered(true)}
      onMouseLeave={() => setPanelHovered(false)}
    >
      {/* Header — focus is carried by the fill + inset accent bar, never a panel outline */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "0 4px 0 10px", height: 28,
        borderBottom: `1px solid ${t.borderMid}`,
        userSelect: "none", flexShrink: 0,
        ...rowState(t, focused),
      }}>
        <span style={dot(t, runState)} />
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setRenameValue(title); setRenaming(false); }
              e.stopPropagation();
            }}
            style={{
              background: "none", border: "none",
              borderBottom: `1px solid ${t.blue}`,
              color: t.label1, fontSize: 12.5,
              outline: "none", padding: "0 2px", minWidth: 60, maxWidth: 160, ...SYS_FONT,
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 12.5, fontWeight: focused ? 600 : 400,
              color: focused ? t.label1 : t.label2,
              cursor: "text", flex: "0 1 auto", ...SYS_FONT, ...CLIP,
            }}
            onDoubleClick={() => { setRenaming(true); setRenameValue(title); }}
            title="Double-click to rename"
          >{title}</span>
        )}
        {gitBranch && (
          <span style={{ ...chip(t), fontSize: 10, maxWidth: 150, ...CLIP_LEFT }} title={gitBranch}>{gitBranch}</span>
        )}
        <span style={{ flex: 1 }} />
        {/* Leftmost so it can appear without shifting the buttons beside it */}
        {onFlipAxis && splitDir && (
          <button
            onClick={(e) => { e.stopPropagation(); onFlipAxis(id); }}
            style={headerBtn(true)}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.label1; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.label3; }}
            title={splitDir === "row" ? "Stack split vertically (⌘⇧R)" : "Place split side by side (⌘⇧R)"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h10l-3-3"/><path d="M17 17H7l3 3"/></svg>
          </button>
        )}
        {onSplit && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); if (canSplit) onSplit(id, "row"); }}
              style={headerBtn(canSplit)}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.label1; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.label3; }}
              title="Split right (⌘⇧⏎)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16"/></svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); if (canSplit) onSplit(id, "column"); }}
              style={headerBtn(canSplit)}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.label1; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.label3; }}
              title="Split down (⌘⇧D)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 12h18"/></svg>
            </button>
          </>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); if (canClose) onClose(id); }}
          style={headerBtn(canClose)}
          onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.red; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.label3; }}
          title="Close (⌃W)"
        >×</button>
      </div>

      {/* Find overlay (⌘F) */}
      {searchOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", top: 34, right: 10, zIndex: 6,
            display: "flex", alignItems: "center", gap: 2,
            background: t.surface2, border: `1px solid ${t.border}`,
            borderRadius: RADIUS, padding: "3px 4px 3px 8px",
            boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          }}
        >
          <input
            ref={searchInputRef}
            autoFocus
            value={searchQuery}
            placeholder="Find"
            onChange={(e) => { const v = e.target.value; setSearchQuery(v); runSearch(v, true); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") { e.preventDefault(); if (e.shiftKey) searchPrevious(searchQuery); else searchNext(searchQuery); }
              else if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
            }}
            style={{
              background: "none", border: "none", outline: "none",
              color: t.label1, fontSize: 12, width: 140, ...MONO_FONT,
            }}
          />
          <span style={{ color: t.label3, fontSize: 11, minWidth: 42, textAlign: "center", ...MONO_FONT, ...TABULAR }}>
            {searchResults.resultCount > 0
              ? `${searchResults.resultIndex + 1}/${searchResults.resultCount}`
              : searchQuery ? "0/0" : ""}
          </span>
          <button title="Previous (⇧⏎)" onClick={() => searchPrevious(searchQuery)} style={searchBtn}>↑</button>
          <button title="Next (⏎)" onClick={() => searchNext(searchQuery)} style={searchBtn}>↓</button>
          <button title="Close (Esc)" onClick={closeSearch} style={searchBtn}>×</button>
        </div>
      )}

      {/* Terminal area */}
      <div style={{ flex: 1, padding: 4, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
      </div>

      {/* Bottom status bar */}
      {(cwd || claudeSessionId || (taskSummary && taskSummary.total > 0)) && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "0 8px", height: 26,
          background: t.surface0,
          borderTop: `1px solid ${t.borderMid}`,
          flexShrink: 0,
          fontSize: 11.5, minWidth: 0,
          ...MONO_FONT, ...TABULAR,
        }}>
          {cwd && (
            <button
              onClick={(e) => { e.stopPropagation(); if (sessionId) setShowDirPicker(true); }}
              title="Change directory"
              disabled={!sessionId}
              style={{
                display: "flex", alignItems: "center", gap: 5, flex: "0 1 auto", minWidth: 0,
                background: "none", border: "none", padding: "2px 5px",
                borderRadius: RADIUS_SM, cursor: sessionId ? "pointer" : "default", textAlign: "left",
                color: t.label3, fontSize: 11.5, ...MONO_FONT,
                transition: TRANSITION,
              }}
              onMouseEnter={(e) => { if (sessionId) { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.label2; } }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.label3; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
              </svg>
              {/* Ellipsize from the left — the leaf directory matters more than the prefix */}
              <span style={CLIP_LEFT}>{formatCwd(cwd)}</span>
            </button>
          )}
          <span style={{ flex: 1, minWidth: 0 }} />
          {taskSummary && taskSummary.total > 0 && (
            <span
              title={
                taskSummary.inProgress > 0
                  ? (taskSummary.tasks.find((tk) => tk.status === "in_progress")?.activeForm
                      ?? taskSummary.tasks.find((tk) => tk.status === "in_progress")?.subject
                      ?? "in progress")
                  : `${taskSummary.completed}/${taskSummary.total} tasks done`
              }
              style={{
                display: "flex", alignItems: "center", gap: 5, flex: "none",
                color: taskSummary.completed === taskSummary.total ? t.green : t.blue,
                fontSize: 11,
              }}
            >
              <span>✓ {taskSummary.completed}/{taskSummary.total}</span>
              <span style={{ width: 26, height: 3, borderRadius: RADIUS_SM, background: t.borderMid, overflow: "hidden", display: "inline-block" }}>
                <span style={{
                  display: "block", height: "100%",
                  width: `${Math.round((taskSummary.completed / taskSummary.total) * 100)}%`,
                  background: taskSummary.completed === taskSummary.total ? t.green : t.blue,
                  transition: "width 0.2s",
                }} />
              </span>
            </span>
          )}
          {claudeSessionId && (
            <span
              onClick={(e) => { e.stopPropagation(); copyClaudeId(); }}
              title={copied ? "Copied!" : `Click to copy: claude --resume ${claudeSessionId}`}
              style={{
                color: copied ? t.green : t.purple,
                cursor: "pointer",
                flex: "none",
                fontSize: 11,
                transition: TRANSITION,
              }}
            >⬢ {copied ? "copied" : claudeSessionId.slice(0, 8)}</span>
          )}
        </div>
      )}

      {/* Directory picker → cd this terminal (starts from its current dir) */}
      {showDirPicker && sessionId && (
        <DirectoryPicker
          title="Change directory"
          initialPath={cwd}
          openLabel="cd here"
          openHint="cd here"
          repos={[]}
          onClose={() => setShowDirPicker(false)}
          onOpenDir={(abs) => window.terminal.write(sessionId, `cd ${shellQuote(abs)}\r`)}
        />
      )}
    </div>
  );
});
