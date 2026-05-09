import { useEffect } from "react";
import { useTheme } from "../ThemeContext";
import { SYS_FONT } from "../theme";

interface Props {
  onClose: () => void;
  onOpenRoot: () => void;
  onOpenInRepo: (repoName: string) => void;
  repos: { name: string }[];
}

export function NewTerminalModal({ onClose, onOpenRoot, onOpenInRepo, repos }: Props) {
  const { theme: t } = useTheme();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const rowStyle: React.CSSProperties = {
    background: t.surface2,
    border: `1px solid ${t.borderSubtle}`,
    borderRadius: 8,
    padding: "11px 14px",
    cursor: "pointer",
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    gap: 10,
    transition: "all 0.15s",
    width: "100%",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: t.surface1, border: `1px solid ${t.border}`,
          borderRadius: 12, width: 380, overflow: "hidden",
          boxShadow: t.isDark ? "0 32px 80px rgba(0,0,0,0.7)" : "0 16px 48px rgba(0,0,0,0.18)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "13px 16px", borderBottom: `1px solid ${t.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ color: t.label1, fontSize: 13, fontWeight: 700, ...SYS_FONT }}>New Terminal</span>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: t.label3, fontSize: 18, lineHeight: 1, padding: "0 2px",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
          >×</button>
        </div>

        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Root terminal */}
          <button
            onClick={() => { onOpenRoot(); onClose(); }}
            style={rowStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = t.surface3;
              e.currentTarget.style.borderColor = t.green;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = t.surface2;
              e.currentTarget.style.borderColor = t.borderSubtle;
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 8, flexShrink: 0,
              background: `${t.green}12`, border: `1px solid ${t.green}28`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18,
            }}>⬡</div>
            <div>
              <div style={{ color: t.label1, fontSize: 12, fontWeight: 600, marginBottom: 2, ...SYS_FONT }}>Root Terminal</div>
              <div style={{ color: t.label3, fontSize: 11, ...SYS_FONT }}>
                New shell at{" "}
                <code style={{ color: t.green, background: `${t.green}12`, padding: "1px 4px", borderRadius: 3, fontSize: 11 }}>~/</code>
              </div>
            </div>
            <span style={{ marginLeft: "auto", color: t.label4, fontSize: 11, flexShrink: 0, ...SYS_FONT }}>⌘T</span>
          </button>

          {/* Repo list */}
          {repos.length > 0 && (
            <>
              <div style={{
                color: t.label4, fontSize: 10, letterSpacing: "0.1em",
                textTransform: "uppercase", padding: "6px 4px 2px", ...SYS_FONT,
              }}>
                Open terminal in repo
              </div>
              <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {repos.map((repo) => (
                  <button
                    key={repo.name}
                    onClick={() => { onOpenInRepo(repo.name); onClose(); }}
                    style={{ ...rowStyle, padding: "8px 14px" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = t.surface3;
                      e.currentTarget.style.borderColor = t.borderMid;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = t.surface2;
                      e.currentTarget.style.borderColor = t.borderSubtle;
                    }}
                  >
                    <span style={{ color: t.blue, fontSize: 13, flexShrink: 0 }}>⎇</span>
                    <span style={{ color: t.label2, fontSize: 12, flex: 1, textAlign: "left", fontFamily: "monospace" }}>
                      {repo.name}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
