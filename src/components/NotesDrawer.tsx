import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useTheme } from "../ThemeContext";

interface NoteCard {
  id: string;
  title: string;
  command: string;
  description?: string;
  type?: "command" | "note";
  body?: string;
}

interface Props { onClose: () => void; }

type Tab = "commands" | "notes";

function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

const EMPTY_CMD: NoteCard = { id: "", title: "", command: "", description: "", type: "command" };
const EMPTY_NOTE: NoteCard = { id: "", title: "", command: "", body: "", type: "note" };

export function NotesDrawer({ onClose }: Props) {
  const { theme: t } = useTheme();
  const [tab, setTab] = useState<Tab>("commands");
  const [notes, setNotes] = useState<NoteCard[]>([]);
  const [editing, setEditing] = useState<NoteCard | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => { window.terminal.listNotes().then(setNotes); }, []);

  const commands = notes.filter((n) => !n.type || n.type === "command");
  const markdownNotes = notes.filter((n) => n.type === "note");

  const startNew = () => {
    setEditing(tab === "commands"
      ? { ...EMPTY_CMD, id: makeId() }
      : { ...EMPTY_NOTE, id: makeId() });
    setPreview(false);
  };

  const startEdit = (card: NoteCard) => { setEditing({ ...card }); setPreview(false); };

  const save = () => {
    if (!editing || !editing.title.trim()) return;
    if (editing.type === "command" && !editing.command.trim()) return;
    const card = { ...editing, title: editing.title.trim() };
    window.terminal.saveNote(card);
    setNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === card.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = card; return next; }
      return [...prev, card];
    });
    setEditing(null);
  };

  const remove = (id: string) => {
    window.terminal.deleteNote(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (editing?.id === id) setEditing(null);
  };

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const switchTab = (next: Tab) => { setTab(next); setEditing(null); };

  const canSave = editing
    ? editing.title.trim() && (editing.type === "note" || editing.command.trim())
    : false;

  const SYS = { fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" };
  const inputStyle = {
    background: t.surface1, border: `1px solid ${t.borderMid}`,
    borderRadius: 6, color: t.label1, fontSize: 12, padding: "6px 10px",
    outline: "none", width: "100%", boxSizing: "border-box" as const, ...SYS,
  };

  const isNoteTab = tab === "notes";
  const currentList = isNoteTab ? markdownNotes : commands;

  return (
    <div style={{
      width: editing && isNoteTab ? 560 : 320, flexShrink: 0,
      background: t.surface1, borderLeft: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column",
      boxShadow: t.isDark ? "-4px 0 28px rgba(0,0,0,0.6)" : "-4px 0 16px rgba(0,0,0,0.08)",
      transition: "width 0.15s ease",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 14px", borderBottom: `1px solid ${t.border}`,
        flexShrink: 0, background: t.headerBg,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: t.label1, flex: 1, ...SYS }}>Notes</span>
        <button
          onClick={startNew}
          style={{
            background: `${t.green ?? t.teal}18`, border: `1px solid ${t.green ?? t.teal}35`,
            borderRadius: 5, color: t.green ?? t.teal,
            cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "2px 10px",
            transition: "all 0.15s", flexShrink: 0, ...SYS,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = `${t.green ?? t.teal}30`; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = `${t.green ?? t.teal}18`; }}
        >+ Add</button>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
        >×</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, background: t.surface1, flexShrink: 0 }}>
        {(["commands", "notes"] as Tab[]).map((id) => (
          <button
            key={id}
            onClick={() => switchTab(id)}
            style={{
              flex: 1, background: "none", border: "none",
              borderBottom: tab === id ? `2px solid ${t.purple}` : "2px solid transparent",
              color: tab === id ? t.purple : t.label3,
              cursor: "pointer", fontSize: 11, fontWeight: tab === id ? 700 : 500,
              padding: "8px 4px 6px", transition: "all 0.15s", ...SYS,
              textTransform: "capitalize",
            }}
          >
            {id}
            <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>
              {id === "commands" ? commands.length : markdownNotes.length}
            </span>
          </button>
        ))}
      </div>

      {/* Edit form */}
      {editing && (
        <div style={{
          padding: "12px 14px", borderBottom: `1px solid ${t.border}`,
          background: t.surface2, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8,
        }}>
          <input
            autoFocus
            placeholder="Title"
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            style={inputStyle}
          />

          {editing.type === "command" ? (
            <>
              <input
                placeholder="Command (e.g. npm run dev)"
                value={editing.command}
                onChange={(e) => setEditing({ ...editing, command: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(null); }}
                style={{ ...inputStyle, color: t.teal, fontFamily: "monospace" }}
              />
              <input
                placeholder="Description (optional)"
                value={editing.description ?? ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(null); }}
                style={{ ...inputStyle, color: t.label3, fontSize: 11 }}
              />
            </>
          ) : (
            <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
              {/* Preview toggle */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => setPreview((v) => !v)}
                  style={{
                    background: preview ? `${t.purple}18` : "none",
                    border: `1px solid ${preview ? t.purple + "50" : t.borderSubtle}`,
                    borderRadius: 4, color: preview ? t.purple : t.label3,
                    cursor: "pointer", fontSize: 10, padding: "2px 8px", ...SYS,
                  }}
                >{preview ? "Edit" : "Preview"}</button>
              </div>

              {preview ? (
                <div style={{
                  background: t.surface1, border: `1px solid ${t.borderMid}`,
                  borderRadius: 6, padding: "8px 12px", minHeight: 160,
                  maxHeight: 320, overflowY: "auto",
                }}>
                  <MarkdownContent body={editing.body ?? ""} t={t} />
                </div>
              ) : (
                <textarea
                  placeholder={`Write in Markdown...\n\n# Heading\n**bold**, *italic*\n- list item\n\`\`\`code block\`\`\``}
                  value={editing.body ?? ""}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }}
                  rows={10}
                  style={{
                    ...inputStyle, resize: "vertical", fontFamily: "monospace",
                    fontSize: 12, lineHeight: 1.6, color: t.label1,
                  }}
                />
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => setEditing(null)}
              style={{ background: "none", border: `1px solid ${t.border}`, borderRadius: 5, color: t.label3, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "4px 12px", ...SYS }}
            >Cancel</button>
            <button
              onClick={save}
              disabled={!canSave}
              style={{ background: t.blue, border: "none", borderRadius: 5, color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "4px 14px", opacity: canSave ? 1 : 0.4, transition: "opacity 0.15s", ...SYS }}
            >Save</button>
          </div>
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {currentList.length === 0 && !editing ? (
          <div style={{ padding: 20, color: t.label4, fontSize: 12, textAlign: "center", ...SYS }}>
            No {isNoteTab ? "notes" : "commands"} yet.{" "}
            <strong style={{ color: t.label3 }}>+ Add</strong> to create one.
          </div>
        ) : isNoteTab ? (
          currentList.map((card) => (
            <NoteItem key={card.id} card={card} t={t} SYS={SYS}
              isEditing={editing?.id === card.id}
              onEdit={() => startEdit(card)}
              onDelete={() => remove(card.id)}
            />
          ))
        ) : (
          currentList.map((card) => (
            <CommandItem key={card.id} card={card} t={t} SYS={SYS}
              isEditing={editing?.id === card.id}
              copied={copied}
              onEdit={() => startEdit(card)}
              onDelete={() => remove(card.id)}
              onCopy={(text) => copy(text, card.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function CommandItem({ card, t, SYS, isEditing, copied, onEdit, onDelete, onCopy }: {
  card: NoteCard; t: ReturnType<typeof import("../ThemeContext").useTheme>["theme"];
  SYS: object; isEditing: boolean; copied: string | null;
  onEdit: () => void; onDelete: () => void; onCopy: (text: string) => void;
}) {
  return (
    <div style={{ padding: "10px 14px", borderBottom: `1px solid ${(t as any).borderSubtle}`, background: isEditing ? `${(t as any).blue}08` : "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: (t as any).label1, flex: 1, ...SYS }}>{card.title}</span>
        <button onClick={onEdit} title="Edit" style={{ background: "none", border: `1px solid ${(t as any).borderSubtle}`, borderRadius: 4, color: (t as any).label3, cursor: "pointer", fontSize: 10, padding: "1px 6px", transition: "all 0.15s" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = (t as any).label1; e.currentTarget.style.borderColor = (t as any).borderMid; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = (t as any).label3; e.currentTarget.style.borderColor = (t as any).borderSubtle; }}>✎</button>
        <button onClick={onDelete} title="Delete" style={{ background: "none", border: `1px solid ${(t as any).red}30`, borderRadius: 4, color: (t as any).red, cursor: "pointer", fontSize: 10, padding: "1px 6px", transition: "all 0.15s" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = `${(t as any).red}15`; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>×</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <code style={{ flex: 1, fontSize: 11, color: (t as any).teal, fontFamily: "monospace", background: (t as any).surface2, border: `1px solid ${(t as any).borderSubtle}`, borderRadius: 4, padding: "3px 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.command}</code>
        <button onClick={() => onCopy(card.command)} title="Copy command" style={{ background: copied === card.id ? `${(t as any).teal}20` : "none", border: `1px solid ${copied === card.id ? (t as any).teal + "50" : (t as any).borderSubtle}`, borderRadius: 4, color: copied === card.id ? (t as any).teal : (t as any).label3, cursor: "pointer", fontSize: 10, padding: "2px 7px", transition: "all 0.15s", flexShrink: 0 }}>{copied === card.id ? "✓" : "⌘C"}</button>
      </div>
      {card.description && <div style={{ fontSize: 10, color: (t as any).label4, marginTop: 4, ...SYS }}>{card.description}</div>}
    </div>
  );
}

function NoteItem({ card, t, SYS, isEditing, onEdit, onDelete }: {
  card: NoteCard; t: ReturnType<typeof import("../ThemeContext").useTheme>["theme"];
  SYS: object; isEditing: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid ${(t as any).borderSubtle}`, background: isEditing ? `${(t as any).blue}08` : "transparent" }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", cursor: "pointer", transition: "background 0.12s" }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = `${(t as any).purple}10`)}
        onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = isEditing ? `${(t as any).blue}08` : "")}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: (t as any).label1, flex: 1, ...SYS }}>{card.title}</span>
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit" style={{ background: "none", border: `1px solid ${(t as any).borderSubtle}`, borderRadius: 4, color: (t as any).label3, cursor: "pointer", fontSize: 10, padding: "1px 6px", transition: "all 0.15s" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = (t as any).label1; e.currentTarget.style.borderColor = (t as any).borderMid; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = (t as any).label3; e.currentTarget.style.borderColor = (t as any).borderSubtle; }}>✎</button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete" style={{ background: "none", border: `1px solid ${(t as any).red}30`, borderRadius: 4, color: (t as any).red, cursor: "pointer", fontSize: 10, padding: "1px 6px", transition: "all 0.15s" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = `${(t as any).red}15`; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>×</button>
        <span style={{ fontSize: 11, color: (t as any).label3, display: "inline-block", transition: "transform 0.15s", transform: expanded ? "rotate(90deg)" : "none" }}>›</span>
      </div>
      {expanded && (
        <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${(t as any).borderSubtle}` }}>
          {card.body ? (
            <MarkdownContent body={card.body} t={t} />
          ) : (
            <span style={{ fontSize: 11, color: (t as any).label4, fontStyle: "italic" }}>No content</span>
          )}
        </div>
      )}
    </div>
  );
}

function MarkdownContent({ body, t }: { body: string; t: ReturnType<typeof import("../ThemeContext").useTheme>["theme"] }) {
  return (
    <div style={{ fontSize: 12, color: (t as any).label2, lineHeight: 1.7, fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" }}>
      <style>{`
        .md-content h1, .md-content h2, .md-content h3 { color: ${(t as any).label1}; margin: 10px 0 4px; font-weight: 700; }
        .md-content h1 { font-size: 15px; }
        .md-content h2 { font-size: 13px; }
        .md-content h3 { font-size: 12px; }
        .md-content p { margin: 4px 0; }
        .md-content ul, .md-content ol { padding-left: 18px; margin: 4px 0; }
        .md-content li { margin: 2px 0; }
        .md-content code { font-family: monospace; font-size: 11px; background: ${(t as any).surface3}; color: ${(t as any).teal}; padding: 1px 5px; border-radius: 3px; }
        .md-content pre { background: ${(t as any).surface3}; border: 1px solid ${(t as any).borderSubtle}; border-radius: 6px; padding: 10px; margin: 6px 0; overflow-x: auto; }
        .md-content pre code { background: none; padding: 0; color: ${(t as any).label2}; }
        .md-content strong { color: ${(t as any).label1}; font-weight: 700; }
        .md-content em { color: ${(t as any).label2}; font-style: italic; }
        .md-content blockquote { border-left: 3px solid ${(t as any).purple}; margin: 6px 0; padding-left: 10px; color: ${(t as any).label3}; }
        .md-content a { color: ${(t as any).blue}; }
        .md-content hr { border: none; border-top: 1px solid ${(t as any).borderSubtle}; margin: 8px 0; }
      `}</style>
      <div className="md-content">
        <ReactMarkdown>{body}</ReactMarkdown>
      </div>
    </div>
  );
}
