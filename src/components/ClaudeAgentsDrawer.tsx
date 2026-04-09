import { useEffect, useState, useCallback } from "react";
import { useTheme } from "../ThemeContext";

interface Agent { name: string; description: string; model?: string; color?: string; tools: string[]; filename: string; }
interface Command { name: string; description: string; filename: string; }
interface Skill { name: string; description: string; }
interface Hook { event: string; matcher?: string; command: string; }
interface Props { onClose: () => void; onOpenTerminal: (path: string) => void; }

type Tab = "agents" | "commands" | "skills" | "hooks";

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

export function ClaudeAgentsDrawer({ onClose, onOpenTerminal }: Props) {
  const { theme: t } = useTheme();
  const [tab, setTab] = useState<Tab>("agents");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);

  const fetchAll = useCallback(() => {
    Promise.all([
      window.terminal.listClaudeAgents(),
      window.terminal.listClaudeCommands(),
      window.terminal.listClaudeSkills(),
      window.terminal.listClaudeHooks(),
    ]).then(([a, c, s, h]) => { setAgents(a); setCommands(c); setSkills(s); setHooks(h); });
  }, []);

  const handleRefresh = () => {
    setSpinning(true);
    fetchAll();
    setTimeout(() => setSpinning(false), 600);
  };

  useEffect(() => {
    fetchAll();
    // Poll every 5 minutes
    const interval = setInterval(fetchAll, 5 * 60 * 1000);
    // Watch for fs changes pushed from main process
    const cleanup = window.terminal.onClaudeConfigChanged(fetchAll);
    return () => { clearInterval(interval); cleanup(); };
  }, [fetchAll]);

  // Reset expanded when switching tabs
  const switchTab = (t: Tab) => { setTab(t); setExpanded(null); };

  const TAB_LABELS: { id: Tab; label: string; count: number }[] = [
    { id: "agents", label: "Agents", count: agents.length },
    { id: "commands", label: "Commands", count: commands.length },
    { id: "skills", label: "Skills", count: skills.length },
    { id: "hooks", label: "Hooks", count: hooks.length },
  ];

  const SYS = { fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" };

  const openDirBtn = (path: string) => (
    <button
      onClick={(e) => { e.stopPropagation(); onOpenTerminal(path); }}
      title={`Open ${path} in terminal`}
      style={{
        background: "none", border: `1px solid ${t.borderSubtle}`, borderRadius: 4,
        color: t.label3, cursor: "pointer", fontSize: 10, padding: "2px 6px",
        flexShrink: 0, transition: "all 0.12s", ...SYS,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = t.teal; e.currentTarget.style.borderColor = t.teal; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = t.label3; e.currentTarget.style.borderColor = t.borderSubtle; }}
    >cd</button>
  );

  return (
    <div style={{
      width: 360, flexShrink: 0,
      background: t.surface1, borderLeft: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column",
      boxShadow: t.isDark ? "-4px 0 28px rgba(0,0,0,0.6)" : "-4px 0 16px rgba(0,0,0,0.08)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: `1px solid ${t.border}`,
        flexShrink: 0, background: t.headerBg,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: t.label1, ...SYS }}>Claude Code</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={handleRefresh}
          title="Refresh"
          style={{
            background: "none", border: "none", color: t.label3, cursor: "pointer",
            fontSize: 13, lineHeight: 1, padding: 0,
            display: "inline-block",
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
      <div style={{
        display: "flex", borderBottom: `1px solid ${t.border}`,
        background: t.surface1, flexShrink: 0,
      }}>
        {TAB_LABELS.map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => switchTab(id)}
            style={{
              flex: 1, background: "none",
              border: "none", borderBottom: tab === id ? `2px solid ${t.teal}` : "2px solid transparent",
              color: tab === id ? t.teal : t.label3,
              cursor: "pointer", fontSize: 11, fontWeight: tab === id ? 700 : 500,
              padding: "8px 4px 6px", transition: "all 0.15s", ...SYS,
            }}
          >
            {label}
            <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>{count}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* ── Agents ── */}
        {tab === "agents" && (
          agents.length === 0
            ? <Empty text="No agents in ~/.claude/agents/" />
            : agents.map((a) => {
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
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      {openDirBtn("$HOME/.claude/agents")}
                      <span style={{ fontSize: 11, color: t.label3, transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "none", display: "inline-block" }}>›</span>
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
          commands.length === 0
            ? <Empty text="No commands in ~/.claude/commands/" />
            : commands.map((c) => (
              <div key={c.filename} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${t.borderSubtle}` }}>
                <span style={{ fontSize: 12, color: t.purple, flexShrink: 0, marginTop: 1 }}>/</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.label1, fontFamily: "monospace", marginBottom: 3 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: t.label3, lineHeight: 1.4, ...SYS }}>{c.description || <em>No description</em>}</div>
                </div>
                {openDirBtn("$HOME/.claude/commands")}
              </div>
            ))
        )}

        {/* ── Skills ── */}
        {tab === "skills" && (
          skills.length === 0
            ? <Empty text="No skills in ~/.claude/skills/" />
            : skills.map((s) => (
              <div key={s.name} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${t.borderSubtle}` }}>
                <span style={{ fontSize: 11, color: t.orange, flexShrink: 0, marginTop: 2 }}>⚡</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.label1, fontFamily: "monospace", marginBottom: 3 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: t.label3, lineHeight: 1.4, ...SYS }}>{s.description || <em>No description</em>}</div>
                </div>
                {openDirBtn(`$HOME/.claude/skills/${s.name}`)}
              </div>
            ))
        )}

        {/* ── Hooks ── */}
        {tab === "hooks" && (
          hooks.length === 0
            ? <Empty text="No hooks in ~/.claude/settings.json" />
            : hooks.map((h, i) => {
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
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      {openDirBtn("$HOME/.claude")}
                      <span style={{ fontSize: 11, color: t.label3, transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "none", display: "inline-block" }}>›</span>
                    </div>
                  </div>
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
