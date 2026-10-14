import { useState, useEffect, useRef, useMemo } from "react";
import { useTheme } from "../ThemeContext";
import { MONO_FONT, SYS_FONT } from "../theme";
import { RADIUS } from "../chrome";

export type ResultKind = "command" | "session" | "agent" | "note" | "repo" | "file";

export interface Command {
  id: string;
  title: string;
  section: string;
  hint?: string;      // right-aligned shortcut, e.g. "⌘T"
  keywords?: string;  // extra searchable text, not shown
  subtitle?: string;  // dimmed secondary text (e.g. path, description)
  kind?: ResultKind;  // defaults to "command"
  run: () => void;
}

// Entity actions injected by the host; when absent the palette is command-only (legacy behaviour).
export interface UnifiedActions {
  openRepo: (repo: string) => void;
  reopenSession: (num: number) => void;
  runNote: (command: string) => void;
  openAgentFile: (filename: string) => void;
  openFile: (repo: string, path: string) => void;
}

interface Props {
  commands: Command[];
  onClose: () => void;
  focusedRepo?: string | null;
  repos?: { name: string }[];
  actions?: UnifiedActions;
}

type AccentKey = "blue" | "green" | "orange" | "red" | "purple" | "teal";

const KIND_META: Record<ResultKind, { label: string; glyph: string; tint: AccentKey }> = {
  command: { label: "Commands", glyph: "⌘", tint: "blue" },
  session: { label: "Sessions", glyph: "⏱", tint: "teal" },
  agent: { label: "Agents", glyph: "⬡", tint: "purple" },
  note: { label: "Notes", glyph: "✎", tint: "orange" },
  repo: { label: "Repos", glyph: "⎇", tint: "green" },
  file: { label: "Files", glyph: "⧉", tint: "red" },
};

const trunc = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const base = (p: string) => p.split("/").pop() || p;
function relTime(ms: number): string {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function CommandPalette({ commands, onClose, focusedRepo, repos, actions }: Props) {
  const { theme: t } = useTheme();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [scope, setScope] = useState<ResultKind | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Entity sources (fetched lazily on open; all local fs reads)
  const [sessions, setSessions] = useState<{ number: number; lastModified: number; title?: string }[]>([]);
  const [agents, setAgents] = useState<{ name: string; description: string; filename: string }[]>([]);
  const [notes, setNotes] = useState<{ id: string; title: string; command: string }[]>([]);
  const [fileList, setFileList] = useState<{ repo: string; files: string[] } | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!actions) return;
    let cancelled = false;
    Promise.all([
      window.terminal.listHistory(),
      window.terminal.listClaudeAgents(),
      window.terminal.listNotes(),
    ]).then(([h, a, n]) => {
      if (cancelled) return;
      setSessions(h);
      setAgents(a.map((x) => ({ name: x.name, description: x.description, filename: x.filename })));
      setNotes(n.filter((x) => x.command).map((x) => ({ id: x.id, title: x.title, command: x.command })));
    });
    return () => { cancelled = true; };
  }, [actions]);

  // Load the focused repo's file index the first time the Files scope is entered.
  useEffect(() => {
    if (scope !== "file" || !focusedRepo || !actions) return;
    if (fileList?.repo === focusedRepo) return;
    let cancelled = false;
    window.terminal.listFiles(focusedRepo).then((files) => { if (!cancelled) setFileList({ repo: focusedRepo, files }); });
    return () => { cancelled = true; };
  }, [scope, focusedRepo, actions, fileList]);

  const q = query.trim().toLowerCase();

  const chipKinds = useMemo<ResultKind[]>(() => {
    if (!actions) return [];
    return ["command", "session", "agent", "note", "repo", ...(focusedRepo ? ["file" as const] : [])];
  }, [actions, focusedRepo]);

  const baseResults = useMemo<Command[]>(() => {
    const cmd: Command[] = commands.map((c) => ({ ...c, kind: c.kind ?? "command" }));
    if (!actions) return cmd;
    // Uncap when searching or when a specific (non-file) chip is active; otherwise show a tidy preview.
    const cap = q || (scope && scope !== "file") ? Infinity : 6;
    const sess: Command[] = [...sessions]
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, cap)
      .map((s) => ({
        id: `sess-${s.number}`, kind: "session", section: "Sessions",
        title: s.title || `terminal ${s.number}`, subtitle: relTime(s.lastModified),
        keywords: `terminal ${s.number}`, run: () => actions.reopenSession(s.number),
      }));
    const agt: Command[] = agents.slice(0, cap).map((a) => ({
      id: `agent-${a.filename}`, kind: "agent", section: "Agents",
      title: a.name, subtitle: trunc(a.description, 64), keywords: a.description,
      run: () => actions.openAgentFile(a.filename),
    }));
    const nt: Command[] = notes.slice(0, cap).map((n) => ({
      id: `note-${n.id}`, kind: "note", section: "Notes",
      title: n.title, subtitle: trunc(n.command, 56), keywords: n.command,
      run: () => actions.runNote(n.command),
    }));
    const rp: Command[] = (repos ?? []).slice(0, cap).map((r) => ({
      id: `repo-${r.name}`, kind: "repo", section: "Repositories",
      title: r.name, keywords: r.name, run: () => actions.openRepo(r.name),
    }));
    return [...cmd, ...sess, ...agt, ...nt, ...rp];
  }, [commands, actions, sessions, agents, notes, repos, q, scope]);

  const fileResults = useMemo<Command[]>(() => {
    if (scope !== "file" || !fileList || fileList.repo !== focusedRepo || !actions) return [];
    const matched = q ? fileList.files.filter((f) => f.toLowerCase().includes(q)) : fileList.files;
    return matched.slice(0, 60).map((p) => ({
      id: `file-${p}`, kind: "file", section: "Files",
      title: base(p), subtitle: p, keywords: p, run: () => actions.openFile(focusedRepo, p),
    }));
  }, [scope, fileList, focusedRepo, q, actions]);

  const filtered = useMemo(() => {
    const scoped = scope === "file" ? fileResults : scope ? baseResults.filter((r) => r.kind === scope) : baseResults;
    if (!q) return scoped;
    return scoped.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      (r.subtitle ?? "").toLowerCase().includes(q) ||
      r.section.toLowerCase().includes(q) ||
      (r.keywords ?? "").toLowerCase().includes(q)
    );
  }, [baseResults, fileResults, scope, q]);

  useEffect(() => { setCursor(0); }, [query, scope]);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`) as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const confirm = (idx: number) => {
    const cmd = filtered[idx];
    if (cmd) { onClose(); cmd.run(); }
  };

  const cycleScope = (dir: 1 | -1) => {
    if (!chipKinds.length) return;
    const cycle: (ResultKind | null)[] = [null, ...chipKinds];
    const i = cycle.indexOf(scope);
    setScope(cycle[(i + dir + cycle.length) % cycle.length]);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "Tab") { e.preventDefault(); cycleScope(e.shiftKey ? -1 : 1); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); confirm(cursor); }
  };

  const emptyMsg = scope === "file"
    ? (!focusedRepo ? "Open a terminal in a repo to search files." : !fileList ? "Indexing files…" : `No files match "${query}"`)
    : q ? "No results." : "No matches.";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: 80,
        background: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 520,
        background: t.isDark ? "rgba(28,28,30,0.96)" : "rgba(255,255,255,0.96)",
        border: `1px solid ${t.border}`, borderRadius: RADIUS,
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)", overflow: "hidden",
        backdropFilter: "blur(40px) saturate(200%)", WebkitBackdropFilter: "blur(40px) saturate(200%)",
      }}>
        {/* Search bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px", borderBottom: `1px solid ${t.borderMid}`,
        }}>
          <span style={{ fontSize: 14, color: t.label3, lineHeight: 1 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={scope ? `Search ${KIND_META[scope].label.toLowerCase()}…` : "Search sessions, agents, files, commands…"}
            style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 13, color: t.label1, ...SYS_FONT }}
          />
          <span style={{ fontSize: 10, color: t.label4, ...SYS_FONT, letterSpacing: 0.3 }}>ESC</span>
        </div>

        {/* Category chips */}
        {chipKinds.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 14px 4px" }}>
            {([null, ...chipKinds] as (ResultKind | null)[]).map((k) => {
              const active = scope === k;
              const label = k ? KIND_META[k].label : "All";
              const tint = k ? t[KIND_META[k].tint] : t.blue;
              return (
                <button
                  key={k ?? "all"}
                  onMouseDown={(e) => { e.preventDefault(); setScope(k); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: active ? `${tint}22` : t.surface2, // 8-digit hex → ~13% tint fill
                    border: `1px solid ${active ? tint : t.borderSubtle}`,
                    borderRadius: RADIUS, padding: "4px 12px", cursor: "pointer",
                    color: active ? tint : t.label2, fontSize: 11.5, fontWeight: active ? 600 : 500,
                    ...SYS_FONT, transition: "all 0.12s",
                  }}
                >
                  {label}
                  {k && <span style={{ fontSize: 11, color: tint, opacity: active ? 1 : 0.85 }}>{KIND_META[k].glyph}</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Results */}
        <div ref={listRef} style={{ maxHeight: 400, overflowY: "auto", paddingTop: 4 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "16px 14px", fontSize: 12, color: t.label4, ...SYS_FONT }}>{emptyMsg}</div>
          ) : (
            filtered.map((cmd, i) => {
              const showHeader = i === 0 || filtered[i - 1].section !== cmd.section;
              const selected = i === cursor;
              return (
                <div key={cmd.id}>
                  {showHeader && (
                    <div style={{
                      padding: "8px 14px 4px", fontSize: 9.5, fontWeight: 600, letterSpacing: 0.6,
                      textTransform: "uppercase", color: t.label4, ...SYS_FONT,
                    }}>{cmd.section}</div>
                  )}
                  <div
                    data-idx={i}
                    onMouseEnter={() => setCursor(i)}
                    onMouseDown={() => confirm(i)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", cursor: "pointer",
                      background: selected ? (t.isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.06)") : "transparent",
                      transition: "background 0.08s",
                    }}
                  >
                    <span style={{ width: 16, flexShrink: 0, textAlign: "center", fontSize: 12, color: t[KIND_META[cmd.kind ?? "command"].tint] }}>
                      {KIND_META[cmd.kind ?? "command"].glyph}
                    </span>
                    <span style={{
                      flexShrink: 0, maxWidth: "52%", fontSize: 13, fontWeight: selected ? 600 : 400, color: t.label1, ...SYS_FONT,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>{cmd.title}</span>
                    {cmd.subtitle && (
                      <span style={{
                        flex: 1, minWidth: 0, fontSize: 11, color: t.label4, fontFamily: cmd.kind === "file" ? MONO_FONT.fontFamily : SYS_FONT.fontFamily,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>{cmd.subtitle}</span>
                    )}
                    {cmd.hint && (
                      <kbd style={{
                        marginLeft: "auto", background: t.surface2, border: `1px solid ${t.borderMid}`, borderRadius: RADIUS,
                        padding: "1px 6px", fontSize: 10, ...MONO_FONT, color: t.label3, flexShrink: 0,
                      }}>{cmd.hint}</kbd>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12,
          padding: "6px 14px", borderTop: `1px solid ${t.borderSubtle}`,
          background: t.isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.03)",
        }}>
          {[["↑↓", "navigate"], ["⇥", "category"], ["↵", "open"], ["esc", "close"]].map(([key, label]) => (
            <span key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: t.label4, ...SYS_FONT }}>
              <kbd style={{
                background: t.surface2, border: `1px solid ${t.borderMid}`, borderRadius: RADIUS,
                padding: "1px 5px", fontSize: 10, ...MONO_FONT, color: t.label3,
              }}>{key}</kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
