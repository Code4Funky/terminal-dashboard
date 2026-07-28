import { useEffect, useState } from "react";
import { useTheme } from "../ThemeContext";
import { formatSize, formatDate } from "../utils/format";
import { RADIUS, drawerHeader, drawerTitle } from "../chrome";
import { MONO_FONT } from "../theme";

interface HistoryEntry { number: number; size: number; lastModified: number; title?: string; }
interface ClaudeEntry { claudeSessionId: string; cwd: string; startedAt: number; }
interface Props {
  openNumbers: number[];
  onReopen: (num: number) => void;
  onResumeClaude: (num: number, claudeSessionId: string, cwd: string) => void;
  onClose: () => void;
}

export function HistoryDrawer({ openNumbers, onReopen, onResumeClaude, onClose }: Props) {
  const { theme: t } = useTheme();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [clearing, setClearing] = useState(false);
  const [hoveredNum, setHoveredNum] = useState<number | null>(null);
  const [claudeMap, setClaudeMap] = useState<Record<number, ClaudeEntry[]>>({});
  const [hookStatus, setHookStatus] = useState<{ scriptPath: string; installed: boolean } | null>(null);
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  const refresh = () => {
    window.terminal.listHistory().then(setEntries);
    window.terminal.getAllPanelClaudeSessions().then(setClaudeMap);
    window.terminal.getClaudeHookStatus().then(setHookStatus);
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const cleanup = window.terminal.onClaudeSessionRecorded(() => {
      window.terminal.getAllPanelClaudeSessions().then(setClaudeMap);
    });
    return cleanup;
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { if (pickerFor !== null) setPickerFor(null); else onClose(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, pickerFor]);

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

  const handleInstallHook = async () => {
    const result = await window.terminal.installClaudeHook();
    if (result.ok) {
      const status = await window.terminal.getClaudeHookStatus();
      setHookStatus(status);
    } else {
      alert(`Failed to install Claude hook: ${result.error ?? "unknown error"}`);
    }
  };

  const handleResume = (num: number, sessions: ClaudeEntry[]) => {
    if (sessions.length === 1) {
      const s = sessions[0];
      onResumeClaude(num, s.claudeSessionId, s.cwd);
    } else {
      setPickerFor(num);
    }
  };

  return (
    <div style={{
      width: 320, flexShrink: 0,
      background: t.surface1,
      backdropFilter: t.backdropFilter,
      WebkitBackdropFilter: t.backdropFilter,
      borderLeft: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column",
      boxShadow: t.isDark ? "-4px 0 28px rgba(0,0,0,0.6)" : "-4px 0 16px rgba(0,0,0,0.08)",
    }}>
      <div style={{ ...drawerHeader(t), justifyContent: "space-between" }}>
        <span style={{ ...drawerTitle(t), flex: 1 }}>Terminal history</span>
        {closedCount > 0 && (
          <button
            onClick={handleClearClosed} disabled={clearing}
            style={{
              background: `${t.red}10`, border: `1px solid ${t.red}30`,
              borderRadius: RADIUS, color: t.red,
              cursor: clearing ? "not-allowed" : "pointer",
              fontSize: 10, fontWeight: 600, padding: "2px 8px",
              opacity: clearing ? 0.5 : 1, transition: "all 0.15s", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `${t.red}20`; e.currentTarget.style.borderColor = `${t.red}50`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `${t.red}10`; e.currentTarget.style.borderColor = `${t.red}30`; }}
          >Clear closed ({closedCount})</button>
        )}
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
        >×</button>
      </div>

      {hookStatus && !hookStatus.installed && (
        <div style={{
          padding: "10px 14px",
          background: `${t.blue}10`,
          borderBottom: `1px solid ${t.borderSubtle}`,
          fontSize: 11, color: t.label2, lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, color: t.label1, marginBottom: 4 }}>Track Claude sessions</div>
          <div style={{ marginBottom: 8, color: t.label3 }}>
            Install a Claude SessionStart hook to remember session IDs and resume them later from this drawer.
          </div>
          <button
            onClick={handleInstallHook}
            style={{
              background: `${t.blue}25`, border: `1px solid ${t.blue}55`,
              borderRadius: RADIUS, color: t.blue, cursor: "pointer",
              fontSize: 10, fontWeight: 600, padding: "3px 10px",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `${t.blue}35`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `${t.blue}25`; }}
          >Enable session tracking</button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto" }}>
        {entries.length === 0 ? (
          <div style={{ padding: 16, color: t.label3, fontSize: 12, ...MONO_FONT }}>No history found.</div>
        ) : (
          entries.map((e) => {
            const isOpen = openSet.has(e.number);
            const sessions = (claudeMap[e.number] ?? []).slice().sort((a, b) => b.startedAt - a.startedAt);
            const hasClaude = sessions.length > 0;
            return (
              <div key={e.number}>
                <div
                  onMouseEnter={() => setHoveredNum(e.number)}
                  onMouseLeave={() => setHoveredNum(null)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 14px",
                    borderBottom: pickerFor === e.number ? "none" : `1px solid ${t.borderSubtle}`, gap: 8,
                    background: isOpen ? `${t.teal}08` : hoveredNum === e.number ? (t.isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)") : "transparent",
                    transition: "background 0.12s",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: t.label2, ...MONO_FONT, display: "flex", alignItems: "center", gap: 6 }}>
                      {e.title ?? `terminal ${e.number}`}
                      {isOpen && (
                        <span style={{
                          fontSize: 9, color: t.teal,
                          border: `1px solid ${t.teal}40`,
                          borderRadius: 3, padding: "0 4px", fontWeight: 600,
                        }}>open</span>
                      )}
                      {hasClaude && (
                        <span
                          title={`${sessions.length} Claude session${sessions.length !== 1 ? "s" : ""} recorded`}
                          style={{
                            fontSize: 9, color: t.purple,
                            border: `1px solid ${t.purple}40`,
                            borderRadius: 3, padding: "0 4px", fontWeight: 600,
                          }}>⬢ {sessions.length}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: t.label4, marginTop: 2, ...MONO_FONT }}>
                      {formatDate(e.lastModified)} · {formatSize(e.size)}
                    </div>
                  </div>
                  {hasClaude && (
                    <button
                      onClick={() => handleResume(e.number, sessions)}
                      title={sessions.length === 1
                        ? `Resume claude --resume ${sessions[0].claudeSessionId.slice(0, 8)}…`
                        : `Pick from ${sessions.length} recorded Claude sessions`}
                      style={{
                        background: `${t.purple}12`,
                        border: `1px solid ${t.purple}35`,
                        borderRadius: RADIUS, color: t.purple,
                        cursor: "pointer",
                        fontSize: 10, fontWeight: 600, padding: "2px 8px",
                        flexShrink: 0, transition: "all 0.15s",
                        opacity: hoveredNum === e.number ? 1 : 0,
                        pointerEvents: hoveredNum === e.number ? "auto" : "none",
                      }}
                      onMouseEnter={(ev) => { ev.currentTarget.style.background = `${t.purple}22`; }}
                      onMouseLeave={(ev) => { ev.currentTarget.style.background = `${t.purple}12`; }}
                    >↻ claude{sessions.length > 1 ? " ▾" : ""}</button>
                  )}
                  <button
                    onClick={() => onReopen(e.number)} disabled={isOpen}
                    style={{
                      background: isOpen ? "none" : `${t.blue}12`,
                      border: `1px solid ${isOpen ? t.borderSubtle : `${t.blue}35`}`,
                      borderRadius: RADIUS, color: isOpen ? t.label4 : t.blue,
                      cursor: isOpen ? "default" : "pointer",
                      fontSize: 10, fontWeight: 600, padding: "2px 8px",
                      flexShrink: 0, transition: "all 0.15s",
                      opacity: hoveredNum === e.number || isOpen ? 1 : 0,
                      pointerEvents: hoveredNum === e.number && !isOpen ? "auto" : "none",
                    }}
                  >Reopen</button>
                  <button
                    onClick={() => { window.terminal.deleteHistory(e.number); setEntries((prev) => prev.filter((x) => x.number !== e.number)); setClaudeMap((prev) => { const next = { ...prev }; delete next[e.number]; return next; }); }}
                    disabled={isOpen}
                    style={{
                      background: "none",
                      border: `1px solid ${isOpen ? t.borderSubtle : `${t.red}30`}`,
                      borderRadius: RADIUS, color: isOpen ? t.label4 : t.red,
                      cursor: isOpen ? "default" : "pointer",
                      fontSize: 10, padding: "2px 8px", flexShrink: 0, transition: "all 0.15s",
                      opacity: hoveredNum === e.number && !isOpen ? 1 : 0,
                      pointerEvents: hoveredNum === e.number && !isOpen ? "auto" : "none",
                    }}
                  >×</button>
                </div>
                {pickerFor === e.number && (
                  <div style={{
                    padding: "4px 14px 8px 14px",
                    borderBottom: `1px solid ${t.borderSubtle}`,
                    background: t.isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                  }}>
                    {sessions.map((s) => (
                      <button
                        key={s.claudeSessionId}
                        onClick={() => { setPickerFor(null); onResumeClaude(e.number, s.claudeSessionId, s.cwd); }}
                        style={{
                          display: "block", width: "100%",
                          textAlign: "left",
                          background: "none",
                          border: `1px solid ${t.borderSubtle}`,
                          borderRadius: RADIUS, color: t.label2,
                          cursor: "pointer",
                          fontSize: 10, ...MONO_FONT,
                          padding: "4px 8px", marginTop: 4,
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={(ev) => { ev.currentTarget.style.background = `${t.purple}15`; ev.currentTarget.style.borderColor = `${t.purple}40`; ev.currentTarget.style.color = t.purple; }}
                        onMouseLeave={(ev) => { ev.currentTarget.style.background = "none"; ev.currentTarget.style.borderColor = t.borderSubtle; ev.currentTarget.style.color = t.label2; }}
                      >
                        <div>{s.claudeSessionId}</div>
                        <div style={{ fontSize: 9, color: t.label4, marginTop: 1 }}>
                          {formatDate(s.startedAt)}{s.cwd ? ` · ${s.cwd.replace(/^.*\//, "")}` : ""}
                        </div>
                      </button>
                    ))}
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
