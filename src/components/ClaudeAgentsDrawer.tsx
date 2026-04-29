import { useEffect, useState, useCallback } from "react";
import { useTheme } from "../ThemeContext";

interface Agent { name: string; description: string; model?: string; color?: string; tools: string[]; filename: string; }
interface Command { name: string; description: string; filename: string; }
interface Skill { name: string; description: string; }
interface Hook { event: string; matcher?: string; command: string; }
interface SessionEntry { filename: string; size: number; lastModified: number; }
interface Message { role: string; content: string; timestamp?: string; }
interface MemoryFile { path: string; label: string; size: number; }
interface Props { onClose: () => void; onOpenTerminal: (path: string) => void; }

type Tab = "agents" | "commands" | "skills" | "hooks" | "sessions" | "memory";

const MODEL_ACCENT: Record<string, string> = { opus: "#bf5af2", sonnet: "#30d158", haiku: "#5ac8fa" };
const AGENT_DOT: Record<string, string> = {
  cyan: "#5ac8fa", purple: "#bf5af2", green: "#30d158",
  blue: "#0a84ff", orange: "#ff9f0a", red: "#ff453a", yellow: "#ffd60a", pink: "#ff375f",
};
const HOOK_ACCENT: Record<string, string> = {
  UserPromptSubmit: "#5ac8fa", Stop: "#ff453a", PostToolUse: "#ff9f0a",
};

function modelAccent(model?: string) {
  if (!model) return "#8e8e93";
  for (const [k, v] of Object.entries(MODEL_ACCENT)) if (model.toLowerCase().includes(k)) return v;
  return "#8e8e93";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatSessionLabel(filename: string): string {
  const m = filename.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return filename.replace(".jsonl", "");
}

export function ClaudeAgentsDrawer({ onClose, onOpenTerminal }: Props) {
  const { theme: t } = useTheme();
  const [tab, setTab] = useState<Tab>("agents");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [memoryFiles, setMemoryFiles] = useState<MemoryFile[]>([]);
  const [memoryContent, setMemoryContent] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sessionView, setSessionView] = useState<{ entry: SessionEntry; messages: Message[]; loading: boolean } | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCount, setActiveCount] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchAll = useCallback(() => {
    Promise.all([
      window.terminal.listClaudeAgents(),
      window.terminal.listClaudeCommands(),
      window.terminal.listClaudeSkills(),
      window.terminal.listClaudeHooks(),
      window.terminal.listClaudeSessions(),
      window.terminal.listClaudeMemoryFiles(),
    ]).then(([a, c, s, h, sess, mem]) => {
      setAgents(a); setCommands(c); setSkills(s); setHooks(h); setSessions(sess); setMemoryFiles(mem);
    });
  }, []);

  const handleRefresh = () => {
    setSpinning(true);
    fetchAll();
    setTimeout(() => setSpinning(false), 600);
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5 * 60 * 1000);
    const cleanup = window.terminal.onClaudeConfigChanged(fetchAll);
    return () => { clearInterval(interval); cleanup(); };
  }, [fetchAll]);

  useEffect(() => {
    const poll = () => window.terminal.getClaudeActiveCount().then(setActiveCount);
    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, []);

  const switchTab = (newTab: Tab) => {
    setTab(newTab); setExpanded(null); setSessionView(null); setSearch("");
  };

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const loadSessionDetail = async (entry: SessionEntry) => {
    setSessionView({ entry, messages: [], loading: true });
    const messages = await window.terminal.readClaudeSession(entry.filename);
    setSessionView({ entry, messages, loading: false });
  };

  const loadMemoryContent = async (file: MemoryFile) => {
    if (expanded === file.path) { setExpanded(null); return; }
    setExpanded(file.path);
    if (!memoryContent[file.path]) {
      const content = await window.terminal.readClaudeMemoryFile(file.path);
      setMemoryContent((prev) => ({ ...prev, [file.path]: content }));
    }
  };

  const q = search.toLowerCase();
  const filterByNameDesc = <T extends { name: string; description?: string }>(items: T[]) =>
    q ? items.filter((i) => i.name.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q)) : items;

  const SYS = { fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" };

  const TAB_LABELS: { id: Tab; label: string; count: number }[] = [
    { id: "agents", label: "Agents", count: agents.length },
    { id: "commands", label: "Cmds", count: commands.length },
    { id: "skills", label: "Skills", count: skills.length },
    { id: "hooks", label: "Hooks", count: hooks.length },
    { id: "sessions", label: "Sessions", count: sessions.length },
    { id: "memory", label: "Memory", count: memoryFiles.length },
  ];

  const isWide = tab === "sessions" && sessionView !== null;

  // ── Action buttons ────────────────────────────────────────────────────────

  const copyBtn = (key: string, text: string) => (
    <button
      onClick={(e) => { e.stopPropagation(); copy(key, text); }}
      title={`Copy: ${text}`}
      style={{
        background: "none", border: `1px solid ${t.borderSubtle}`, borderRadius: 4,
        color: copied === key ? t.green : t.label4, cursor: "pointer", fontSize: 9,
        padding: "1px 5px", flexShrink: 0, transition: "all 0.12s", ...SYS,
      }}
      onMouseEnter={(e) => { if (copied !== key) { e.currentTarget.style.color = t.purple; e.currentTarget.style.borderColor = t.purple; } }}
      onMouseLeave={(e) => { if (copied !== key) { e.currentTarget.style.color = t.label4; e.currentTarget.style.borderColor = t.borderSubtle; } }}
    >{copied === key ? "✓" : "copy"}</button>
  );

  const runBtn = (text: string) => (
    <button
      onClick={(e) => { e.stopPropagation(); window.terminal.writeToFocusedTerminal(text); }}
      title={`Send to terminal: ${text}`}
      style={{
        background: "none", border: `1px solid ${t.borderSubtle}`, borderRadius: 4,
        color: t.label4, cursor: "pointer", fontSize: 9,
        padding: "1px 5px", flexShrink: 0, transition: "all 0.12s", ...SYS,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = t.green; e.currentTarget.style.borderColor = t.green; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = t.label4; e.currentTarget.style.borderColor = t.borderSubtle; }}
    >run</button>
  );

  const editBtn = (filepath: string) => (
    <button
      onClick={(e) => { e.stopPropagation(); window.terminal.openClaudeFile(filepath); }}
      title={`Edit ${filepath}`}
      style={{
        background: "none", border: `1px solid ${t.borderSubtle}`, borderRadius: 4,
        color: t.label4, cursor: "pointer", fontSize: 9,
        padding: "1px 5px", flexShrink: 0, transition: "all 0.12s", ...SYS,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = t.orange; e.currentTarget.style.borderColor = t.orange; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = t.label4; e.currentTarget.style.borderColor = t.borderSubtle; }}
    >edit</button>
  );

  const cdBtn = (path: string) => (
    <button
      onClick={(e) => { e.stopPropagation(); onOpenTerminal(path); }}
      title={`Open ${path} in terminal`}
      style={{
        background: "none", border: `1px solid ${t.borderSubtle}`, borderRadius: 4,
        color: t.label4, cursor: "pointer", fontSize: 9,
        padding: "1px 5px", flexShrink: 0, transition: "all 0.12s", ...SYS,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = t.teal; e.currentTarget.style.borderColor = t.teal; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = t.label4; e.currentTarget.style.borderColor = t.borderSubtle; }}
    >cd</button>
  );

  return (
    <div style={{
      width: isWide ? 520 : 360, flexShrink: 0,
      background: t.surface1, borderLeft: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column",
      boxShadow: t.isDark ? "-4px 0 28px rgba(0,0,0,0.6)" : "-4px 0 16px rgba(0,0,0,0.08)",
      transition: "width 0.15s ease",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: `1px solid ${t.border}`,
        flexShrink: 0, background: t.headerBg,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: t.label1, ...SYS }}>Claude Code</span>
          {activeCount > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%", background: t.green,
                display: "inline-block", boxShadow: `0 0 6px ${t.green}`,
              }} />
              <span style={{ fontSize: 10, color: t.green, fontFamily: "monospace" }}>{activeCount} active</span>
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={handleRefresh}
            title="Refresh"
            style={{
              background: "none", border: "none", color: t.label3, cursor: "pointer",
              fontSize: 13, lineHeight: 1, padding: 0, display: "inline-block",
              transform: spinning ? "rotate(360deg)" : "none",
              transition: spinning ? "transform 0.6s linear, color 0.15s" : "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.teal)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
          >↺</button>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
          >×</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, background: t.surface1, flexShrink: 0 }}>
        {TAB_LABELS.map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => switchTab(id)}
            style={{
              flex: 1, background: "none", border: "none",
              borderBottom: tab === id ? `2px solid ${t.teal}` : "2px solid transparent",
              color: tab === id ? t.teal : t.label3,
              cursor: "pointer", fontSize: 10, fontWeight: tab === id ? 700 : 500,
              padding: "7px 2px 5px", transition: "all 0.15s", ...SYS,
            }}
          >
            {label}<span style={{ marginLeft: 3, fontSize: 9, opacity: 0.7 }}>{count}</span>
          </button>
        ))}
      </div>

      {/* Search (hidden for sessions tab detail view) */}
      {!(tab === "sessions" && sessionView) && (
        <div style={{ padding: "6px 10px", borderBottom: `1px solid ${t.borderSubtle}`, flexShrink: 0 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            style={{
              width: "100%", background: t.surface2, border: `1px solid ${t.borderSubtle}`,
              borderRadius: 6, color: t.label2, fontSize: 11, outline: "none",
              padding: "4px 8px", boxSizing: "border-box" as const, ...SYS,
            }}
          />
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* ── Agents ── */}
        {tab === "agents" && (
          filterByNameDesc(agents).length === 0
            ? <Empty text={agents.length === 0 ? "No agents in ~/.claude/agents/" : "No matches"} />
            : filterByNameDesc(agents).map((a) => {
              const isOpen = expanded === a.filename;
              const dot = AGENT_DOT[a.color?.toLowerCase() ?? ""] ?? "#8e8e93";
              const accent = modelAccent(a.model);
              return (
                <div key={a.filename} style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
                  <div
                    onClick={() => setExpanded(isOpen ? null : a.filename)}
                    style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", cursor: "pointer", transition: "background 0.12s" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = `${t.teal}10`)}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "")}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0, marginTop: 4 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: t.label1, fontFamily: "monospace" }}>{a.name}</span>
                        {a.model && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: accent, background: `${accent}18`, border: `1px solid ${accent}40`, borderRadius: 3, padding: "1px 5px", textTransform: "uppercase" as const, letterSpacing: 0.5, ...SYS }}>
                            {a.model}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: t.label3, lineHeight: 1.4, ...SYS, display: "-webkit-box", WebkitLineClamp: isOpen ? undefined : 2, WebkitBoxOrient: "vertical" as const, overflow: isOpen ? "visible" : "hidden" }}>
                        {a.description || <em>No description</em>}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                      {copyBtn(a.filename, `@${a.name}`)}
                      {runBtn(`@${a.name} `)}
                      {editBtn(`~/.claude/agents/${a.filename}`)}
                      {cdBtn("$HOME/.claude/agents")}
                      <span style={{ fontSize: 11, color: t.label3, transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "none", display: "inline-block", marginLeft: 2 }}>›</span>
                    </div>
                  </div>
                  {isOpen && a.tools.length > 0 && (
                    <div style={{ padding: "0 14px 12px 32px" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: t.label4, textTransform: "uppercase" as const, letterSpacing: 0.8, marginBottom: 6, ...SYS }}>Tools ({a.tools.length})</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {a.tools.map((tool) => (
                          <span key={tool} title={tool} style={{ fontSize: 10, fontFamily: "monospace", color: t.teal, background: `${t.teal}14`, border: `1px solid ${t.teal}30`, borderRadius: 3, padding: "2px 6px" }}>
                            {tool.split("__").pop()}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
        )}

        {/* ── Commands ── */}
        {tab === "commands" && (
          filterByNameDesc(commands).length === 0
            ? <Empty text={commands.length === 0 ? "No commands in ~/.claude/commands/" : "No matches"} />
            : filterByNameDesc(commands).map((c) => (
              <div key={c.filename} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${t.borderSubtle}` }}>
                <span style={{ fontSize: 12, color: t.purple, flexShrink: 0, marginTop: 1 }}>/</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.label1, fontFamily: "monospace", marginBottom: 3 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: t.label3, lineHeight: 1.4, ...SYS }}>{c.description || <em>No description</em>}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                  {copyBtn(`cmd-${c.filename}`, `/${c.name}`)}
                  {runBtn(`/${c.name}`)}
                  {editBtn(`~/.claude/commands/${c.filename}`)}
                  {cdBtn("$HOME/.claude/commands")}
                </div>
              </div>
            ))
        )}

        {/* ── Skills ── */}
        {tab === "skills" && (
          filterByNameDesc(skills).length === 0
            ? <Empty text={skills.length === 0 ? "No skills in ~/.claude/skills/" : "No matches"} />
            : filterByNameDesc(skills).map((s) => (
              <div key={s.name} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${t.borderSubtle}` }}>
                <span style={{ fontSize: 11, color: t.orange, flexShrink: 0, marginTop: 2 }}>⚡</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.label1, fontFamily: "monospace", marginBottom: 3 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: t.label3, lineHeight: 1.4, ...SYS }}>{s.description || <em>No description</em>}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                  {copyBtn(`skill-${s.name}`, s.name)}
                  {editBtn(`~/.claude/skills/${s.name}/SKILL.md`)}
                  {cdBtn(`$HOME/.claude/skills/${s.name}`)}
                </div>
              </div>
            ))
        )}

        {/* ── Hooks ── */}
        {tab === "hooks" && (
          hooks.filter((h) => !q || h.event.toLowerCase().includes(q) || h.command.toLowerCase().includes(q)).length === 0
            ? <Empty text={hooks.length === 0 ? "No hooks in ~/.claude/settings.json" : "No matches"} />
            : hooks
                .filter((h) => !q || h.event.toLowerCase().includes(q) || h.command.toLowerCase().includes(q))
                .map((h, i) => {
                  const accent = HOOK_ACCENT[h.event] ?? t.label3;
                  const isOpen = expanded === `hook-${i}`;
                  return (
                    <div key={i} style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
                      <div
                        onClick={() => setExpanded(isOpen ? null : `hook-${i}`)}
                        style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", cursor: "pointer", transition: "background 0.12s" }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = `${t.teal}10`)}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "")}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0, marginTop: 4, display: "inline-block" }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: accent, ...SYS }}>{h.event}</span>
                            {h.matcher && (
                              <span style={{ fontSize: 9, color: t.label4, background: t.surface3, borderRadius: 3, padding: "1px 5px", fontFamily: "monospace" }}>{h.matcher}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: t.label3, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isOpen ? "pre-wrap" : "nowrap" }}>
                            {h.command}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                          {copyBtn(`hook-${i}`, h.command)}
                          {editBtn("~/.claude/settings.json")}
                          {cdBtn("$HOME/.claude")}
                          <span style={{ fontSize: 11, color: t.label3, transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "none", display: "inline-block", marginLeft: 2 }}>›</span>
                        </div>
                      </div>
                    </div>
                  );
                })
        )}

        {/* ── Sessions list ── */}
        {tab === "sessions" && !sessionView && (
          sessions.filter((s) => !q || s.filename.toLowerCase().includes(q)).length === 0
            ? <Empty text={sessions.length === 0 ? "No sessions in ~/.claude/sessions/" : "No matches"} />
            : sessions
                .filter((s) => !q || s.filename.toLowerCase().includes(q))
                .map((s) => (
                  <div
                    key={s.filename}
                    onClick={() => loadSessionDetail(s)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 14px", borderBottom: `1px solid ${t.borderSubtle}`,
                      cursor: "pointer", gap: 8, transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = `${t.purple}12`)}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "")}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: t.label2, fontFamily: "monospace" }}>{formatSessionLabel(s.filename)}</div>
                      <div style={{ fontSize: 10, color: t.label4, marginTop: 2, fontFamily: "monospace" }}>
                        {formatDate(s.lastModified)} · {formatSize(s.size)}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: t.label3, flexShrink: 0 }}>›</span>
                  </div>
                ))
        )}

        {/* ── Sessions detail ── */}
        {tab === "sessions" && sessionView && (
          <>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 14px", borderBottom: `1px solid ${t.border}`,
              flexShrink: 0, background: t.surface2,
            }}>
              <button
                onClick={() => setSessionView(null)}
                style={{ background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, transition: "color 0.15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = t.purple)}
                onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
              >←</button>
              <span style={{ fontSize: 12, color: t.label2, fontFamily: "monospace", flex: 1 }}>
                {formatSessionLabel(sessionView.entry.filename)}
              </span>
              <span style={{ fontSize: 10, color: t.label4, fontFamily: "monospace" }}>{formatSize(sessionView.entry.size)}</span>
            </div>
            {sessionView.loading
              ? <div style={{ padding: 16, color: t.label3, fontSize: 12, fontFamily: "monospace" }}>Loading…</div>
              : sessionView.messages.length === 0
                ? <div style={{ padding: 16, color: t.label3, fontSize: 12, fontFamily: "monospace" }}>No messages found.</div>
                : sessionView.messages.map((msg, i) => (
                  <div key={i} style={{ padding: "8px 14px", borderBottom: `1px solid ${t.borderSubtle}` }}>
                    <div style={{
                      fontSize: 9, fontWeight: 700,
                      color: msg.role === "user" ? t.blue : t.purple,
                      textTransform: "uppercase" as const, letterSpacing: 0.8, marginBottom: 4,
                    }}>{msg.role}</div>
                    <div style={{ fontSize: 11, color: t.label2, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6, fontFamily: "monospace" }}>
                      {msg.content}
                    </div>
                  </div>
                ))
            }
          </>
        )}

        {/* ── Memory ── */}
        {tab === "memory" && (
          memoryFiles.filter((f) => !q || f.label.toLowerCase().includes(q)).length === 0
            ? <Empty text={memoryFiles.length === 0 ? "No memory files found" : "No matches"} />
            : memoryFiles
                .filter((f) => !q || f.label.toLowerCase().includes(q))
                .map((f) => {
                  const isOpen = expanded === f.path;
                  return (
                    <div key={f.path} style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
                      <div
                        onClick={() => loadMemoryContent(f)}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", transition: "background 0.12s" }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = `${t.teal}10`)}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "")}
                      >
                        <span style={{ fontSize: 11, color: t.purple, flexShrink: 0 }}>◈</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: t.label2, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {f.label}
                          </div>
                          <div style={{ fontSize: 10, color: t.label4, marginTop: 1, fontFamily: "monospace" }}>{formatSize(f.size)}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                          {editBtn(f.path)}
                          <span style={{ fontSize: 11, color: t.label3, transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "none", display: "inline-block", marginLeft: 2 }}>›</span>
                        </div>
                      </div>
                      {isOpen && (
                        <div style={{ padding: "8px 14px 12px 34px", background: t.surface2, borderTop: `1px solid ${t.borderSubtle}` }}>
                          <pre style={{
                            fontSize: 10, color: t.label3, fontFamily: "monospace",
                            whiteSpace: "pre-wrap", wordBreak: "break-word",
                            margin: 0, lineHeight: 1.6, maxHeight: 320, overflowY: "auto",
                          }}>
                            {memoryContent[f.path] ?? "Loading…"}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })
        )}

      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 16, color: "#8e8e93", fontSize: 12, fontFamily: "monospace" }}>{text}</div>;
}
