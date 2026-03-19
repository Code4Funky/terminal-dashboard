import { useRef, useEffect } from "react";
import { useTerminal } from "../hooks/useTerminal";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: string | null;
  panelNumber: number | null;
  title: string;
  cwd?: string;
  onClose: () => void;
  focused: boolean;
  onFocus: () => void;
}

function formatCwd(cwd: string): string {
  const home = "/Users/" + (cwd.split("/")[2] ?? "");
  const shortened = cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  const parts = shortened.split("/").filter(Boolean);
  if (parts.length <= 2) return shortened;
  return "~/" + parts.slice(-2).join("/");
}

export function TerminalPanel({
  sessionId,
  panelNumber,
  title,
  cwd,
  onClose,
  focused,
  onFocus,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { focus } = useTerminal(containerRef, sessionId, panelNumber);

  useEffect(() => {
    if (focused) focus();
  }, [focused]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: focused ? "1px solid #58a6ff" : "1px solid #30363d",
        borderRadius: 6,
        overflow: "hidden",
        background: "#14191e",
        minHeight: 0,
      }}
      onClick={onFocus}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 10px",
          background: "#161b22",
          borderBottom: "1px solid #30363d",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "monospace", fontSize: 12 }}>
          <span style={{ color: focused ? "#58a6ff" : "#8b949e" }}>{title}</span>
          {cwd && (
            <span style={{ color: "#484f58" }}>{formatCwd(cwd)}</span>
          )}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            background: "none",
            border: "none",
            color: "#8b949e",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            padding: "0 2px",
          }}
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Terminal area */}
      <div
        ref={containerRef}
        style={{ flex: 1, padding: "4px", minHeight: 0, overflow: "hidden" }}
      />
    </div>
  );
}
