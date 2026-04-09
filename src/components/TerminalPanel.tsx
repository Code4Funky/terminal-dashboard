import { useRef, useEffect } from "react";
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
  focused: boolean;
  onFocus: () => void;
}

function formatCwd(cwd: string): string {
  const home = "/Users/" + (cwd.split("/")[2] ?? "");
  return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
}

export function TerminalPanel({
  sessionId, panelNumber, title, cwd, gitBranch,
  fontFamily, fontSize, onClose, focused, onFocus,
}: Props) {
  const { theme: t } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const { focus } = useTerminal(containerRef, sessionId, panelNumber, fontFamily, fontSize);

  useEffect(() => {
    if (focused) focus();
  }, [focused]);

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
      onMouseEnter={(e) => { if (!focused) e.currentTarget.style.borderColor = `${t.green}55`; }}
      onMouseLeave={(e) => { if (!focused) e.currentTarget.style.borderColor = t.borderMid; }}
    >
      {/* Title bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 10px",
        background: t.isDark
          ? (focused ? "rgba(44,44,46,0.9)" : "rgba(28,28,30,0.85)")
          : (focused ? "rgba(242,242,247,0.95)" : "rgba(255,255,255,0.9)"),
        borderBottom: `1px solid ${focused ? t.borderMid : t.borderSubtle}`,
        userSelect: "none", flexShrink: 0,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: "monospace" }}>
          <span style={{ color: focused ? t.label1 : t.label3 }}>{title}</span>
          {cwd && <span style={{ color: t.label4 }}>{formatCwd(cwd)}</span>}
          {gitBranch && (
            <span style={{ color: t.red, fontFamily: "monospace" }}>
              git:({gitBranch})
            </span>
          )}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{
            background: "none", border: "none", color: t.label4,
            cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.red)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
          title="Close"
        >×</button>
      </div>

      {/* Terminal area */}
      <div style={{ flex: 1, padding: "4px 4px 32px 4px", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
      </div>
    </div>
  );
}
