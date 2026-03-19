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
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryDrawer({ openNumbers, onReopen, onClose }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    window.terminal.listHistory().then(setEntries);
  }, []);

  const openSet = new Set(openNumbers);

  return (
    <div
      style={{
        position: "absolute",
        top: 41,
        right: 0,
        width: 300,
        bottom: 0,
        background: "#161b22",
        borderLeft: "1px solid #30363d",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        boxShadow: "-4px 0 12px rgba(0,0,0,0.4)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid #30363d",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3" }}>
          Terminal History
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#8b949e",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {entries.length === 0 ? (
          <div style={{ padding: 16, color: "#484f58", fontSize: 12 }}>
            No history found.
          </div>
        ) : (
          entries.map((e) => {
            const isOpen = openSet.has(e.number);
            return (
              <div
                key={e.number}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 14px",
                  borderBottom: "1px solid #21262d",
                  gap: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#e6edf3" }}>
                    terminal {e.number}
                    {isOpen && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 10,
                          color: "#3fb950",
                          border: "1px solid #3fb950",
                          borderRadius: 3,
                          padding: "0 4px",
                        }}
                      >
                        open
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#484f58", marginTop: 2 }}>
                    {formatDate(e.lastModified)} · {formatSize(e.size)}
                  </div>
                </div>
                <button
                  onClick={() => onReopen(e.number)}
                  disabled={isOpen}
                  title={isOpen ? "Already open" : "Reopen"}
                  style={{
                    background: "none",
                    border: "1px solid #30363d",
                    borderRadius: 4,
                    color: isOpen ? "#484f58" : "#58a6ff",
                    cursor: isOpen ? "default" : "pointer",
                    fontSize: 11,
                    padding: "2px 8px",
                    flexShrink: 0,
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
                    border: "1px solid #30363d",
                    borderRadius: 4,
                    color: isOpen ? "#484f58" : "#f85149",
                    cursor: isOpen ? "default" : "pointer",
                    fontSize: 11,
                    padding: "2px 8px",
                    flexShrink: 0,
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
