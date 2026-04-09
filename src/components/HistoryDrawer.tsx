import { useEffect, useState } from "react";
import { useTheme } from "../ThemeContext";

interface HistoryEntry { number: number; size: number; lastModified: number; }
interface Props { openNumbers: number[]; onReopen: (num: number) => void; onClose: () => void; }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function HistoryDrawer({ openNumbers, onReopen, onClose }: Props) {
  const { theme: t } = useTheme();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [clearing, setClearing] = useState(false);

  useEffect(() => { window.terminal.listHistory().then(setEntries); }, []);

  const openSet = new Set(openNumbers);
  const closedCount = entries.filter((e) => !openSet.has(e.number)).length;

  const handleClearClosed = async () => {
    if (clearing) return;
    setClearing(true);
    for (const e of entries.filter((e) => !openSet.has(e.number))) {
      await window.terminal.deleteHistory(e.number);
    }
    setEntries((prev) => prev.filter((e) => openSet.has(e.number)));
    setClearing(false);
  };

  return (
    <div style={{
      width: 300, flexShrink: 0,
      background: t.surface1,
      borderLeft: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column",
      boxShadow: t.isDark ? "-4px 0 28px rgba(0,0,0,0.6)" : "-4px 0 16px rgba(0,0,0,0.08)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: `1px solid ${t.border}`,
        flexShrink: 0, background: t.headerBg, gap: 8,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: t.label1, flex: 1 }}>Terminal History</span>
        {closedCount > 0 && (
          <button
            onClick={handleClearClosed} disabled={clearing}
            style={{
              background: `${t.red}10`, border: `1px solid ${t.red}30`,
              borderRadius: 5, color: t.red,
              cursor: clearing ? "not-allowed" : "pointer",
              fontSize: 10, fontWeight: 600, padding: "2px 8px",
              opacity: clearing ? 0.5 : 1, transition: "all 0.15s", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `${t.red}20`; e.currentTarget.style.borderColor = `${t.red}50`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `${t.red}10`; e.currentTarget.style.borderColor = `${t.red}30`; }}
          >🗑 Clear closed ({closedCount})</button>
        )}
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
        >×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {entries.length === 0 ? (
          <div style={{ padding: 16, color: t.label3, fontSize: 12, fontFamily: "monospace" }}>No history found.</div>
        ) : (
          entries.map((e) => {
            const isOpen = openSet.has(e.number);
            return (
              <div key={e.number} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 14px",
                borderBottom: `1px solid ${t.borderSubtle}`, gap: 8,
                background: isOpen ? `${t.teal}08` : "transparent",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: t.label2, fontFamily: "monospace", display: "flex", alignItems: "center", gap: 6 }}>
                    terminal {e.number}
                    {isOpen && (
                      <span style={{
                        fontSize: 9, color: t.teal,
                        border: `1px solid ${t.teal}40`,
                        borderRadius: 3, padding: "0 4px", fontWeight: 600,
                      }}>open</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: t.label4, marginTop: 2, fontFamily: "monospace" }}>
                    {formatDate(e.lastModified)} · {formatSize(e.size)}
                  </div>
                </div>
                <button
                  onClick={() => onReopen(e.number)} disabled={isOpen}
                  style={{
                    background: isOpen ? "none" : `${t.blue}12`,
                    border: `1px solid ${isOpen ? t.borderSubtle : `${t.blue}35`}`,
                    borderRadius: 4, color: isOpen ? t.label4 : t.blue,
                    cursor: isOpen ? "default" : "pointer",
                    fontSize: 10, fontWeight: 600, padding: "2px 8px",
                    flexShrink: 0, transition: "all 0.15s",
                  }}
                >Reopen</button>
                <button
                  onClick={() => { window.terminal.deleteHistory(e.number); setEntries((prev) => prev.filter((x) => x.number !== e.number)); }}
                  disabled={isOpen}
                  style={{
                    background: "none",
                    border: `1px solid ${isOpen ? t.borderSubtle : `${t.red}30`}`,
                    borderRadius: 4, color: isOpen ? t.label4 : t.red,
                    cursor: isOpen ? "default" : "pointer",
                    fontSize: 10, padding: "2px 8px", flexShrink: 0, transition: "all 0.15s",
                  }}
                >×</button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
