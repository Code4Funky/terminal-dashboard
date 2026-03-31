import { useRef, useEffect } from "react";
import { useTerminal } from "../hooks/useTerminal";
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
          ? "1px solid rgba(255,255,255,0.18)"
          : "1px solid rgba(255,255,255,0.07)",
        borderRadius: 8, overflow: "hidden",
        background: "rgba(255,255,255,0.02)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        minHeight: 0,
        boxShadow: focused
          ? "0 0 0 1px rgba(96,165,250,0.1), 0 4px 28px rgba(0,0,0,0.4)"
          : "0 2px 14px rgba(0,0,0,0.3)",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
      onClick={onFocus}
    >
      {/* Title bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 10px",
        background: focused ? "rgba(15, 20, 35, 0.75)" : "rgba(10, 12, 20, 0.65)",
        borderBottom: focused
          ? "1px solid rgba(255,255,255,0.1)"
          : "1px solid rgba(255,255,255,0.05)",
        userSelect: "none", flexShrink: 0,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
          <span style={{ color: focused ? "#e2e8f0" : "#475569" }}>{title}</span>
          {cwd && <span style={{ color: "#334155" }}>{formatCwd(cwd)}</span>}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{
            background: "none", border: "none", color: "#334155",
            cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#f87171")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#334155")}
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Terminal area */}
      <div style={{ flex: 1, padding: "4px 4px 32px 4px", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
      </div>
    </div>
  );
}
