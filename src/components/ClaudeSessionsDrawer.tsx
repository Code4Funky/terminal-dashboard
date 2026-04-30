import { useEffect, useState } from "react";
import { useTheme } from "../ThemeContext";
import { formatSize, formatDate, formatSessionLabel } from "../utils/format";

interface SessionEntry { filename: string; size: number; lastModified: number; }
interface Message { role: string; content: string; timestamp?: string; }
interface Props { onClose: () => void; }

export function ClaudeSessionsDrawer({ onClose }: Props) {
  const { theme: t } = useTheme();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [selected, setSelected] = useState<SessionEntry | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { window.terminal.listClaudeSessions().then(setSessions); }, []);

  const handleSelect = async (entry: SessionEntry) => {
    setSelected(entry); setLoading(true);
    const msgs = await window.terminal.readClaudeSession(entry.filename);
    setMessages(msgs); setLoading(false);
  };

  return (
    <div style={{
      width: selected ? 520 : 300, flexShrink: 0,
      background: t.surface1,
      borderLeft: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column",
      boxShadow: t.isDark ? "-4px 0 28px rgba(0,0,0,0.6)" : "-4px 0 16px rgba(0,0,0,0.08)",
      transition: "width 0.15s ease",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px",
        borderBottom: `1px solid ${t.border}`,
        flexShrink: 0, background: t.headerBg, gap: 8,
      }}>
        {selected && (
          <button
            onClick={() => { setSelected(null); setMessages([]); }}
            style={{ background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, flexShrink: 0, transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.purple)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
            title="Back to list"
          >←</button>
        )}
        <span style={{ fontSize: 13, fontWeight: 700, color: t.label1, flex: 1 }}>
          {selected ? formatSessionLabel(selected.filename) : "Claude Sessions"}
        </span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
        >×</button>
      </div>

      {!selected ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {sessions.length === 0 ? (
            <div style={{ padding: 16, color: t.label3, fontSize: 12, fontFamily: "monospace" }}>
              No sessions found in ~/.claude/sessions/
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.filename} onClick={() => handleSelect(s)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 14px", borderBottom: `1px solid ${t.borderSubtle}`,
                  cursor: "pointer", gap: 8, transition: "background 0.12s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = `${t.purple}12`)}
                onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "")}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: t.label2, fontFamily: "monospace" }}>
                    {formatSessionLabel(s.filename)}
                  </div>
                  <div style={{ fontSize: 10, color: t.label4, marginTop: 2, fontFamily: "monospace" }}>
                    {formatDate(s.lastModified)} · {formatSize(s.size)}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: t.label3, flexShrink: 0 }}>›</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {loading ? (
            <div style={{ padding: 16, color: t.label3, fontSize: 12, fontFamily: "monospace" }}>Loading…</div>
          ) : messages.length === 0 ? (
            <div style={{ padding: 16, color: t.label3, fontSize: 12, fontFamily: "monospace" }}>No messages found.</div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} style={{ padding: "8px 14px", borderBottom: `1px solid ${t.borderSubtle}` }}>
                <div style={{
                  fontSize: 9, fontWeight: 700,
                  color: msg.role === "user" ? t.blue : t.purple,
                  textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4,
                }}>
                  {msg.role}
                </div>
                <div style={{ fontSize: 12, color: t.label2, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6, fontFamily: "monospace" }}>
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
