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
  const m = filename.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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

  const glassStyle: React.CSSProperties = {
    width: selected ? 520 : 300,
    flexShrink: 0,
    background: "rgba(7, 5, 20, 0.84)",
    backdropFilter: "blur(28px) saturate(160%)",
    WebkitBackdropFilter: "blur(28px) saturate(160%)",
    borderLeft: "1px solid rgba(139, 92, 246, 0.15)",
    display: "flex",
    flexDirection: "column",
    boxShadow: "-4px 0 32px rgba(0,0,0,0.5)",
    transition: "width 0.15s ease",
  };

  return (
    <div style={glassStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid rgba(139, 92, 246, 0.1)",
          flexShrink: 0,
          background: "rgba(10, 8, 28, 0.5)",
          gap: 8,
        }}
      >
        {selected && (
          <button
            onClick={() => { setSelected(null); setMessages([]); }}
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
              flexShrink: 0,
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#a78bfa")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
            title="Back to list"
          >
            ←
          </button>
        )}
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", flex: 1, fontFamily: "'Syne', sans-serif" }}>
          {selected ? formatSessionLabel(selected.filename) : "Claude Sessions"}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#475569",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#e2e8f0")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#475569")}
        >
          ×
        </button>
      </div>

      {/* Content */}
      {!selected ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {sessions.length === 0 ? (
            <div style={{ padding: 16, color: "#334155", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
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
                  borderBottom: "1px solid rgba(139, 92, 246, 0.07)",
                  cursor: "pointer",
                  gap: 8,
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.background = "rgba(139, 92, 246, 0.07)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.background = "")
                }
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "#c4b5fd", fontFamily: "'DM Mono', monospace" }}>
                    {formatSessionLabel(s.filename)}
                  </div>
                  <div style={{ fontSize: 10, color: "#334155", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
                    {formatDate(s.lastModified)} · {formatSize(s.size)}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: "#475569", flexShrink: 0 }}>›</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {loading ? (
            <div style={{ padding: 16, color: "#334155", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
              Loading…
            </div>
          ) : messages.length === 0 ? (
            <div style={{ padding: 16, color: "#334155", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
              No messages found.
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 14px",
                  borderBottom: "1px solid rgba(139, 92, 246, 0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: msg.role === "user" ? "#60a5fa" : "#a78bfa",
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                    marginBottom: 4,
                    fontFamily: "'Syne', sans-serif",
                  }}
                >
                  {msg.role}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#94a3b8",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    lineHeight: 1.6,
                    fontFamily: "'DM Mono', monospace",
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
