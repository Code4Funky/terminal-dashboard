import { useEffect, useState } from "react";

interface SessionEntry {
  filename: string;
  size: number;
  lastModified: number;
}

interface Message {
  role: string;
  content: string;
  timestamp?: string;
}

interface Props {
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

function formatSessionLabel(filename: string): string {
  // e.g. 20260321-143012-abcd1234.jsonl → Mar 21, 14:30
  const m = filename.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (m) {
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6])
    );
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return filename.replace(".jsonl", "");
}

export function ClaudeSessionsDrawer({ onClose }: Props) {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [selected, setSelected] = useState<SessionEntry | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    window.terminal.listClaudeSessions().then(setSessions);
  }, []);

  const handleSelect = async (entry: SessionEntry) => {
    setSelected(entry);
    setLoading(true);
    const msgs = await window.terminal.readClaudeSession(entry.filename);
    setMessages(msgs);
    setLoading(false);
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 41,
        right: 0,
        width: selected ? 520 : 300,
        bottom: 0,
        background: "#161b22",
        borderLeft: "1px solid #30363d",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        boxShadow: "-4px 0 12px rgba(0,0,0,0.4)",
        transition: "width 0.15s ease",
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
          gap: 8,
        }}
      >
        {selected && (
          <button
            onClick={() => { setSelected(null); setMessages([]); }}
            style={{
              background: "none",
              border: "none",
              color: "#8b949e",
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
              flexShrink: 0,
            }}
            title="Back to list"
          >
            ←
          </button>
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e6edf3", flex: 1 }}>
          {selected ? formatSessionLabel(selected.filename) : "Claude Sessions"}
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

      {/* Content */}
      {!selected ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {sessions.length === 0 ? (
            <div style={{ padding: 16, color: "#484f58", fontSize: 12 }}>
              No sessions found in ~/.claude/sessions/
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.filename}
                onClick={() => handleSelect(s)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 14px",
                  borderBottom: "1px solid #21262d",
                  cursor: "pointer",
                  gap: 8,
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.background = "#1c2128")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.background = "")
                }
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#e6edf3" }}>
                    {formatSessionLabel(s.filename)}
                  </div>
                  <div style={{ fontSize: 11, color: "#484f58", marginTop: 2 }}>
                    {formatDate(s.lastModified)} · {formatSize(s.size)}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: "#8b949e", flexShrink: 0 }}>›</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {loading ? (
            <div style={{ padding: 16, color: "#484f58", fontSize: 12 }}>
              Loading…
            </div>
          ) : messages.length === 0 ? (
            <div style={{ padding: 16, color: "#484f58", fontSize: 12 }}>
              No messages found.
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 14px",
                  borderBottom: "1px solid #21262d",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: msg.role === "user" ? "#58a6ff" : "#3fb950",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 4,
                  }}
                >
                  {msg.role}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#c9d1d9",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    lineHeight: 1.5,
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
