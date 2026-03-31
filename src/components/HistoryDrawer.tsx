import { useEffect, useState } from "react";

interface HistoryEntry {
  number: number;
  size: number;
  lastModified: number;
}

interface Props {
  openNumbers: number[];
  onReopen: (num: number) => void;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function HistoryDrawer({ openNumbers, onReopen, onClose }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    window.terminal.listHistory().then(setEntries);
  }, []);

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
      background: "rgba(10, 26, 15, 0.84)",
      backdropFilter: "blur(28px) saturate(150%)",
      WebkitBackdropFilter: "blur(28px) saturate(150%)",
      borderLeft: "1px solid rgba(0, 255, 135, 0.12)",
      display: "flex", flexDirection: "column",
      boxShadow: "-4px 0 28px rgba(0,0,0,0.4)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: "1px solid rgba(0, 255, 135, 0.1)",
        flexShrink: 0,
        background: "rgba(8, 20, 12, 0.5)",
        gap: 8,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e2fff3", flex: 1, fontFamily: "'Syne', sans-serif" }}>
          Terminal History
        </span>
        {closedCount > 0 && (
          <button
            onClick={handleClearClosed}
            disabled={clearing}
            title="Delete all closed history"
            style={{
              background: "rgba(248, 113, 113, 0.07)",
              border: "1px solid rgba(248, 113, 113, 0.22)",
              borderRadius: 5, color: "#f87171",
              cursor: clearing ? "not-allowed" : "pointer",
              fontSize: 10, fontWeight: 600, padding: "2px 8px",
              opacity: clearing ? 0.5 : 1, transition: "all 0.15s",
              flexShrink: 0, fontFamily: "'Syne', sans-serif",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(248,113,113,0.13)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(248,113,113,0.07)"; }}
          >
            🗑 Clear closed ({closedCount})
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none",
            color: "rgba(0,210,120,0.28)",
            cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0,
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#e2fff3")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(0,210,120,0.28)")}
        >
          ×
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {entries.length === 0 ? (
          <div style={{ padding: 16, color: "rgba(0,210,120,0.28)", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
            No history found.
          </div>
        ) : (
          entries.map((e) => {
            const isOpen = openSet.has(e.number);
            return (
              <div
                key={e.number}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 14px",
                  borderBottom: "1px solid rgba(0, 255, 135, 0.06)",
                  gap: 8,
                  background: isOpen ? "rgba(0, 255, 135, 0.04)" : "transparent",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "#d4ffee", fontFamily: "'DM Mono', monospace", display: "flex", alignItems: "center", gap: 6 }}>
                    terminal {e.number}
                    {isOpen && (
                      <span style={{
                        fontSize: 9, color: "#00f080",
                        border: "1px solid rgba(0,255,135,0.35)",
                        borderRadius: 3, padding: "0 4px",
                        fontFamily: "'Syne', sans-serif", fontWeight: 600,
                      }}>
                        open
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(0,210,120,0.28)", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
                    {formatDate(e.lastModified)} · {formatSize(e.size)}
                  </div>
                </div>
                <button
                  onClick={() => onReopen(e.number)}
                  disabled={isOpen}
                  title={isOpen ? "Already open" : "Reopen"}
                  style={{
                    background: isOpen ? "none" : "rgba(0, 255, 135, 0.07)",
                    border: `1px solid ${isOpen ? "rgba(0,255,135,0.07)" : "rgba(0,255,135,0.22)"}`,
                    borderRadius: 4, color: isOpen ? "rgba(0,210,120,0.28)" : "#00f080",
                    cursor: isOpen ? "default" : "pointer",
                    fontSize: 10, fontWeight: 600, padding: "2px 8px",
                    flexShrink: 0, fontFamily: "'Syne', sans-serif", transition: "all 0.15s",
                  }}
                >
                  Reopen
                </button>
                <button
                  onClick={() => {
                    window.terminal.deleteHistory(e.number);
                    setEntries((prev) => prev.filter((x) => x.number !== e.number));
                  }}
                  disabled={isOpen}
                  title={isOpen ? "Close terminal first" : "Delete history"}
                  style={{
                    background: "none",
                    border: `1px solid ${isOpen ? "rgba(0,255,135,0.07)" : "rgba(248,113,113,0.2)"}`,
                    borderRadius: 4, color: isOpen ? "rgba(0,210,120,0.28)" : "#f87171",
                    cursor: isOpen ? "default" : "pointer",
                    fontSize: 10, padding: "2px 8px",
                    flexShrink: 0, transition: "all 0.15s",
                  }}
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
