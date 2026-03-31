import { useState, useEffect, useRef } from "react";
import { TerminalPanel } from "./TerminalPanel";
import { HistoryDrawer } from "./HistoryDrawer";
import { ClaudeSessionsDrawer } from "./ClaudeSessionsDrawer";
import { StatsDrawer } from "./StatsDrawer";
import { PRsDrawer } from "./PRsDrawer";

interface PanelState {
  id: string;
  sessionId: string;
  number: number;
  title: string;
  cwd?: string;
  gitBranch?: string;
}

type Columns = 1 | 2 | 3 | 4;

const COLUMN_OPTIONS: { cols: Columns; icon: string; label: string }[] = [
  { cols: 1, icon: "▣", label: "1 col" },
  { cols: 2, icon: "⬒", label: "2 cols" },
  { cols: 3, icon: "⊟", label: "3 cols" },
  { cols: 4, icon: "⊞", label: "4 cols" },
];

function savePanels(panels: PanelState[]) {
  window.terminal.savePanels(
    panels.map((p) => ({ number: p.number, title: p.title }))
  );
}

export function Dashboard() {
  const [columns, setColumns] = useState<Columns>(1);
  const [panels, setPanels] = useState<PanelState[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showClaudeSessions, setShowClaudeSessions] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showPRs, setShowPRs] = useState(false);
  const [worktreeConfirm, setWorktreeConfirm] = useState<{ repoName: string; branchName: string; wtPath: string } | null>(null);
  const [termFont, setTermFont] = useState<{ family: string; size: number; files: string[] } | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    window.terminal.getIterm2Font().then((font) => {
      setTermFont(font);
      initPanels();
    });
  }, []);

  async function initPanels() {
    window.terminal.getState().then(async ({ lastPanels }) => {
      const toRestore = lastPanels.length > 0 ? lastPanels : null;
      if (toRestore) {
        const restored: PanelState[] = [];
        for (const saved of toRestore) {
          const { sessionId } = await window.terminal.create(220, 50, saved.number);
          restored.push({ id: sessionId, sessionId, number: saved.number, title: saved.title });
        }
        setPanels(restored);
        const last = restored.at(-1);
        if (last) { setFocusedId(last.id); window.terminal.setFocused(last.sessionId); }
      } else {
        const { sessionId, number } = await window.terminal.create(220, 50);
        const panel: PanelState = { id: sessionId, sessionId, number, title: `terminal ${number}` };
        setPanels([panel]);
        setFocusedId(panel.id);
        window.terminal.setFocused(panel.sessionId);
        savePanels([panel]);
      }
    });
  }

  useEffect(() => {
    const handler = () => savePanels(panels);
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [panels]);

  useEffect(() => {
    const cleanup = window.terminal.onCwdUpdate((sessionId, cwd, gitBranch) => {
      setPanels((prev) =>
        prev.map((p) => (p.sessionId === sessionId ? { ...p, cwd, gitBranch: gitBranch || undefined } : p))
      );
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const cleanup = window.terminal.onNewPanel((sessionId, number) => {
      const panel: PanelState = { id: sessionId, sessionId, number, title: `terminal ${number}` };
      setPanels((prev) => {
        const next = [...prev, panel];
        savePanels(next);
        return next;
      });
      setFocusedId(sessionId);
    });
    return cleanup;
  }, []);

  const handleAddPanel = async () => {
    const { sessionId, number } = await window.terminal.create(220, 50);
    const panel: PanelState = { id: sessionId, sessionId, number, title: `terminal ${number}` };
    setPanels((prev) => {
      const next = [...prev, panel];
      savePanels(next);
      return next;
    });
    setFocusedId(sessionId);
  };

  const openBranchInTerminal = async (repoName: string, branchName: string, wtPath: string) => {
    const cmd = `cd "${wtPath}"`;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, cmd);
    const panel: PanelState = { id: sessionId, sessionId, number, title: `${repoName}:${branchName}` };
    setPanels((prev) => {
      const next = [...prev, panel];
      savePanels(next);
      return next;
    });
    setFocusedId(sessionId);
    window.terminal.setFocused(sessionId);
  };

  const handleOpenBranchTerminal = async (repoName: string, branchName: string) => {
    setShowPRs(false);
    try {
      const { exists, path } = await window.terminal.checkWorktree(repoName, branchName);
      if (exists && path) {
        openBranchInTerminal(repoName, branchName, path);
      } else {
        const safeBranch = branchName.replace(/[^a-zA-Z0-9._-]/g, "-");
        const wtPath = `$HOME/Documents/GitHub/${repoName}-${safeBranch}`;
        setWorktreeConfirm({ repoName, branchName, wtPath });
      }
    } catch (e) {
      console.error("handleOpenBranchTerminal failed", e);
    }
  };

  const handleConfirmWorktree = async () => {
    if (!worktreeConfirm) return;
    const { repoName, branchName, wtPath } = worktreeConfirm;
    setWorktreeConfirm(null);
    const createCmd =
      `git -C "$HOME/Documents/GitHub/${repoName}" worktree add "${wtPath}" "${branchName}" && cd "${wtPath}"`;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, createCmd);
    const panel: PanelState = { id: sessionId, sessionId, number, title: `${repoName}:${branchName}` };
    setPanels((prev) => {
      const next = [...prev, panel];
      savePanels(next);
      return next;
    });
    setFocusedId(sessionId);
    window.terminal.setFocused(sessionId);
  };

  const handleReopen = async (num: number) => {
    setShowHistory(false);
    const { sessionId } = await window.terminal.create(220, 50, num);
    const panel: PanelState = { id: sessionId, sessionId, number: num, title: `terminal ${num}` };
    setPanels((prev) => {
      const next = [...prev, panel];
      savePanels(next);
      return next;
    });
    setFocusedId(sessionId);
  };

  const handleClose = (panelId: string) => {
    const panel = panels.find((p) => p.id === panelId);
    if (panel) window.terminal.close(panel.sessionId);
    setPanels((prev) => {
      const next = prev.filter((p) => p.id !== panelId);
      savePanels(next);
      if (focusedId === panelId) setFocusedId(next.at(-1)?.id ?? null);
      return next;
    });
  };

  const colBtnStyle = (active: boolean) => ({
    background: active ? "rgba(255,255,255,0.07)" : "none",
    border: active ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(255,255,255,0.07)",
    borderRadius: 4,
    color: active ? "#e2e8f0" : "#475569",
    cursor: "pointer" as const,
    fontSize: 14,
    padding: "2px 8px",
    transition: "all 0.15s",
  });

  // Each drawer button has its own accent color
  const drawerBtnStyle = (active: boolean, activeColor: string, activeBg: string, activeBorder: string) => ({
    background: active ? activeBg : "none",
    border: active ? `1px solid ${activeBorder}` : "1px solid rgba(255,255,255,0.08)",
    borderRadius: 6,
    color: active ? activeColor : "#475569",
    cursor: "pointer" as const,
    fontSize: 12,
    fontWeight: 600 as const,
    padding: "4px 12px",
    WebkitAppRegion: "no-drag" as const,
    transition: "all 0.15s",
    fontFamily: "'Syne', sans-serif",
  });

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "linear-gradient(135deg, #0f1923 0%, #131f2e 50%, #111827 100%)",
      position: "relative", overflow: "hidden",
    }}>
      {/* Ambient orbs — very subtle tints matching the button palette */}
      <div style={{
        position: "fixed", top: "-15%", left: "-8%",
        width: 560, height: 560, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(59,130,246,0.09) 0%, transparent 65%)",
        filter: "blur(60px)",
        pointerEvents: "none", zIndex: 0,
        animation: "orbFloat1 14s ease-in-out infinite",
      }} />
      <div style={{
        position: "fixed", bottom: "-18%", right: "-6%",
        width: 640, height: 640, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(34,211,238,0.07) 0%, transparent 65%)",
        filter: "blur(72px)",
        pointerEvents: "none", zIndex: 0,
        animation: "orbFloat2 18s ease-in-out infinite",
      }} />
      <div style={{
        position: "fixed", top: "40%", left: "35%",
        width: 360, height: 360, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%)",
        filter: "blur(64px)",
        pointerEvents: "none", zIndex: 0,
      }} />

      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center",
        gap: 8, padding: "6px 12px 6px 80px",
        background: "rgba(8, 10, 18, 0.84)",
        backdropFilter: "blur(24px) saturate(160%)",
        WebkitBackdropFilter: "blur(24px) saturate(160%)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        flexShrink: 0,
        WebkitAppRegion: "drag" as const,
        boxShadow: "0 1px 0 rgba(255,255,255,0.04), 0 2px 16px rgba(0,0,0,0.4)",
        position: "relative", zIndex: 10,
      }}>
        <span style={{
          fontSize: 13, fontWeight: 700, color: "#e2e8f0",
          marginRight: 8, letterSpacing: 0.4,
          fontFamily: "'Syne', sans-serif",
        }}>
          Terminal Dashboard
        </span>

        <div style={{ display: "flex", gap: 4, marginRight: 8, WebkitAppRegion: "no-drag" as const }}>
          {COLUMN_OPTIONS.map(({ cols, icon, label }) => (
            <button
              key={cols} onClick={() => setColumns(cols)} title={label} style={colBtnStyle(columns === cols)}
              onMouseEnter={(e) => { if (columns !== cols) { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; e.currentTarget.style.color = "#94a3b8"; }}}
              onMouseLeave={(e) => { if (columns !== cols) { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "#475569"; }}}
            >
              {icon}
            </button>
          ))}
        </div>

        <button
          onClick={handleAddPanel}
          className="btn-animated-gradient"
          style={{
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12, fontWeight: 700,
            padding: "4px 14px",
            WebkitAppRegion: "no-drag" as const,
            fontFamily: "'Syne', sans-serif",
            letterSpacing: 0.3,
          }}
        >
          + New Terminal
        </button>

        <div style={{ flex: 1 }} />

        {/* PRs — blue */}
        <button
          onClick={() => { setShowPRs((v) => !v); setShowHistory(false); setShowClaudeSessions(false); setShowStats(false); }}
          style={drawerBtnStyle(showPRs, "#60a5fa", "rgba(96,165,250,0.12)", "rgba(96,165,250,0.38)")}
          onMouseEnter={(e) => { if (!showPRs) { e.currentTarget.style.background = "rgba(96,165,250,0.08)"; e.currentTarget.style.borderColor = "rgba(96,165,250,0.28)"; e.currentTarget.style.color = "#60a5fa"; }}}
          onMouseLeave={(e) => { if (!showPRs) { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#475569"; }}}
        >
          PRs
        </button>
        {/* Stats — amber */}
        <button
          onClick={() => { setShowStats((v) => !v); setShowHistory(false); setShowClaudeSessions(false); setShowPRs(false); }}
          style={drawerBtnStyle(showStats, "#fbbf24", "rgba(251,191,36,0.1)", "rgba(251,191,36,0.35)")}
          onMouseEnter={(e) => { if (!showStats) { e.currentTarget.style.background = "rgba(251,191,36,0.07)"; e.currentTarget.style.borderColor = "rgba(251,191,36,0.28)"; e.currentTarget.style.color = "#fbbf24"; }}}
          onMouseLeave={(e) => { if (!showStats) { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#475569"; }}}
        >
          Stats
        </button>
        {/* Claude Sessions — purple */}
        <button
          onClick={() => { setShowClaudeSessions((v) => !v); setShowHistory(false); setShowStats(false); setShowPRs(false); }}
          style={drawerBtnStyle(showClaudeSessions, "#c084fc", "rgba(192,132,252,0.1)", "rgba(192,132,252,0.35)")}
          onMouseEnter={(e) => { if (!showClaudeSessions) { e.currentTarget.style.background = "rgba(192,132,252,0.08)"; e.currentTarget.style.borderColor = "rgba(192,132,252,0.28)"; e.currentTarget.style.color = "#c084fc"; }}}
          onMouseLeave={(e) => { if (!showClaudeSessions) { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#475569"; }}}
        >
          Claude Sessions
        </button>
        {/* History — cyan */}
        <button
          onClick={() => { setShowHistory((v) => !v); setShowClaudeSessions(false); setShowStats(false); setShowPRs(false); }}
          style={drawerBtnStyle(showHistory, "#22d3ee", "rgba(34,211,238,0.1)", "rgba(34,211,238,0.35)")}
          onMouseEnter={(e) => { if (!showHistory) { e.currentTarget.style.background = "rgba(34,211,238,0.07)"; e.currentTarget.style.borderColor = "rgba(34,211,238,0.28)"; e.currentTarget.style.color = "#22d3ee"; }}}
          onMouseLeave={(e) => { if (!showHistory) { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#475569"; }}}
        >
          History
        </button>

        <span style={{ fontSize: 11, color: "#334155", marginLeft: 8, fontFamily: "'DM Mono', monospace" }}>
          {panels.length} session{panels.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Worktree confirmation modal */}
      {worktreeConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0, 0, 0, 0.65)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "rgba(13, 17, 25, 0.94)",
            backdropFilter: "blur(32px)",
            WebkitBackdropFilter: "blur(32px)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 16, padding: "24px 28px", width: 420,
            boxShadow: "0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
          }}>
            <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 15, marginBottom: 8, fontFamily: "'Syne', sans-serif" }}>
              Create worktree?
            </div>
            <div style={{ color: "#475569", fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
              No existing worktree found for{" "}
              <span style={{ color: "#c084fc", fontFamily: "'DM Mono', monospace" }}>{worktreeConfirm.branchName}</span>
              {". A new one will be created at:"}
            </div>
            <div style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8, padding: "8px 12px", marginBottom: 20,
              color: "#22d3ee", fontSize: 11, fontFamily: "'DM Mono', monospace", wordBreak: "break-all",
            }}>
              {worktreeConfirm.wtPath}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setWorktreeConfirm(null)}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8, color: "#94a3b8",
                  cursor: "pointer", fontSize: 12, fontWeight: 600,
                  padding: "7px 18px", fontFamily: "'Syne', sans-serif",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmWorktree}
                className="btn-animated-gradient"
                style={{
                  borderRadius: 8, cursor: "pointer",
                  fontSize: 12, fontWeight: 700,
                  padding: "7px 20px", fontFamily: "'Syne', sans-serif",
                }}
              >
                Create &amp; Open
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content row */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden", position: "relative", zIndex: 1 }}>
        <div style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gridAutoRows: `calc((100vh - 41px) / ${Math.ceil(panels.length / columns)})`,
          gap: 4, padding: 4, minHeight: 0, overflowY: "auto",
        }}>
          {panels.map((panel) => (
            <TerminalPanel
              key={panel.id}
              sessionId={panel.sessionId}
              panelNumber={panel.number}
              title={panel.title}
              cwd={panel.cwd}
              gitBranch={panel.gitBranch}
              focused={panel.id === focusedId}
              fontFamily={termFont?.family}
              fontSize={termFont?.size}
              onFocus={() => { setFocusedId(panel.id); window.terminal.setFocused(panel.sessionId); }}
              onClose={() => handleClose(panel.id)}
            />
          ))}
        </div>

        {showPRs && <PRsDrawer onClose={() => setShowPRs(false)} onOpenTerminal={handleOpenBranchTerminal} />}
        {showStats && <StatsDrawer onClose={() => setShowStats(false)} />}
        {showHistory && (
          <HistoryDrawer openNumbers={panels.map((p) => p.number)} onReopen={handleReopen} onClose={() => setShowHistory(false)} />
        )}
        {showClaudeSessions && <ClaudeSessionsDrawer onClose={() => setShowClaudeSessions(false)} />}
      </div>
    </div>
  );
}
