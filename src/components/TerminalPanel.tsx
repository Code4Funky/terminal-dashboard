import { useRef, useEffect, useState } from "react";
import { useTerminal } from "../hooks/useTerminal";
import { useTheme } from "../ThemeContext";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: string | null;
  panelNumber: number | null;
  title: string;
  cwd?: string;
  gitBranch?: string;
  fontFamily?: string;
  fontSize?: number;
  onClose: () => void;
  onRename?: (title: string) => void;
  canClose?: boolean;
  focused: boolean;
  onFocus: () => void;
}

function formatCwd(cwd: string): string {
  const home = "/Users/" + (cwd.split("/")[2] ?? "");
  return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
}

export function TerminalPanel({
  sessionId, panelNumber, title, cwd, gitBranch,
  fontFamily, fontSize, onClose, onRename, canClose = true, focused, onFocus,
}: Props) {
  const { theme: t } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const { focus } = useTerminal(containerRef, sessionId, panelNumber, fontFamily, fontSize, true);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const [panelHovered, setPanelHovered] = useState(false);

  useEffect(() => {
    if (!renaming) setRenameValue(title);
  }, [title, renaming]);

  useEffect(() => {
    if (focused) focus();
  }, [focused]);

  const commitRename = () => {
    const v = renameValue.trim();
    if (v && v !== title) onRename?.(v);
    else setRenameValue(title);
    setRenaming(false);
  };

  return (
    <div
      style={{
        display: "flex", flexDirection: "column",
        border: focused
          ? `2px solid ${t.green}99`
          : `2px solid ${t.borderMid}`,
        borderRadius: 10, overflow: "hidden",
        background: t.isDark ? "#1C1C1E" : "#FFFFFF",
        minHeight: 0,
        boxShadow: focused
          ? `0 0 0 1px ${t.green}20, 0 4px 28px rgba(0,0,0,0.3)`
          : "0 2px 12px rgba(0,0,0,0.15)",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
      onClick={onFocus}
      onMouseEnter={(e) => { setPanelHovered(true); if (!focused) e.currentTarget.style.borderColor = `${t.green}55`; }}
      onMouseLeave={(e) => { setPanelHovered(false); if (!focused) e.currentTarget.style.borderColor = t.borderMid; }}
    >
      {/* Title bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 8px", height: 24,
        background: t.isDark ? t.surface2 : t.surface1,
        borderBottom: `1px solid ${t.borderSubtle}`,
        userSelect: "none", flexShrink: 0,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "monospace", minWidth: 0 }}>
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
                borderBottom: `1px solid ${t.green}`,
                color: t.label2, fontSize: 11, fontFamily: "monospace",
                outline: "none", padding: "0 2px", minWidth: 60, maxWidth: 160,
              }}
            />
          ) : (
            <span
              style={{ color: t.label3, cursor: "text", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              onDoubleClick={() => { setRenaming(true); setRenameValue(title); }}
              title="Double-click to rename"
            >{title}</span>
          )}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); if (canClose) onClose(); }}
          style={{
            background: "none", border: "none", color: t.red,
            cursor: canClose ? "pointer" : "default", fontSize: 13, lineHeight: 1, padding: "0 2px",
            opacity: (panelHovered || focused) && canClose ? 1 : 0,
            pointerEvents: (panelHovered || focused) && canClose ? "auto" : "none",
            transition: "opacity 0.15s",
            flexShrink: 0,
          }}
          title="Close (⌃W)"
        >×</button>
      </div>

      {/* Terminal area */}
      <div style={{ flex: 1, padding: 4, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
      </div>

      {/* Bottom status bar */}
      {(cwd || gitBranch) && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "2px 10px",
          background: t.isDark ? "rgba(28,28,30,0.85)" : "rgba(248,248,248,0.9)",
          borderTop: `1px solid ${t.borderSubtle}`,
          flexShrink: 0,
          fontSize: 12, fontFamily: "monospace",
          minWidth: 0,
        }}>
          {cwd && (
            <span style={{ color: t.label4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {formatCwd(cwd)}
            </span>
          )}
          {gitBranch && (
            <span style={{ color: t.teal, flexShrink: 0 }}>git:({gitBranch})</span>
          )}
        </div>
      )}
    </div>
  );
}
