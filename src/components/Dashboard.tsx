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
    background: active ? "rgba(0, 255, 135, 0.1)" : "none",
    border: active ? "1px solid rgba(0, 255, 135, 0.4)" : "1px solid rgba(0, 255, 135, 0.12)",
    borderRadius: 4,
    color: active ? "#00f080" : "rgba(0, 240, 128, 0.45)",
    cursor: "pointer" as const,
    fontSize: 14,
    padding: "2px 8px",
    transition: "all 0.15s",
  });

  const drawerBtnStyle = (
    active: boolean,
    activeColor: string,
    activeBg: string,
    activeBorder: string,
  ) => ({
    background: active ? activeBg : "none",
    border: active ? `1px solid ${activeBorder}` : "1px solid rgba(0, 255, 135, 0.1)",
    borderRadius: 6,
    color: active ? activeColor : "rgba(0, 240, 128, 0.35)",
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
      background: "linear-gradient(145deg, #112b1c, #163a24, #12301e, #0f2619)",
      position: "relative", overflow: "hidden",
    }}>
      {/* Ambient orbs */}
      <div style={{
        position: "fixed", top: "-18%", left: "-10%",
        width: 580, height: 580, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(0,255,135,0.18) 0%, transparent 68%)",
        filter: "blur(60px)",
        pointerEvents: "none", zIndex: 0,
        animation: "orbFloat1 13s ease-in-out infinite",
      }} />
      <div style={{
        position: "fixed", bottom: "-22%", right: "-6%",
        width: 660, height: 660, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(0,200,160,0.20) 0%, transparent 68%)",
        filter: "blur(72px)",
        pointerEvents: "none", zIndex: 0,
        animation: "orbFloat2 17s ease-in-out infinite",
      }} />
      <div style={{
        position: "fixed", top: "38%", left: "40%",
        width: 380, height: 380, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(0,220,100,0.13) 0%, transparent 70%)",
        filter: "blur(68px)",
        pointerEvents: "none", zIndex: 0,
      }} />

      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center",
        gap: 8,
        padding: "6px 12px 6px 80px",
        background: "rgba(12, 30, 18, 0.80)",
        backdropFilter: "blur(24px) saturate(160%)",
        WebkitBackdropFilter: "blur(24px) saturate(160%)",
        borderBottom: "1px solid rgba(0, 255, 135, 0.1)",
        flexShrink: 0,
        WebkitAppRegion: "drag" as const,
        boxShadow: "0 1px 0 rgba(0, 255, 135, 0.05), 0 2px 14px rgba(0,0,0,0.3)",
        position: "relative", zIndex: 10,
      }}>
        <span style={{
          fontSize: 13, fontWeight: 700, color: "#e2fff3",
          marginRight: 8, letterSpacing: 0.4,
          fontFamily: "'Syne', sans-serif",
        }}>
          Terminal Dashboard
        </span>

        <div style={{ display: "flex", gap: 4, marginRight: 8, WebkitAppRegion: "no-drag" as const }}>
          {COLUMN_OPTIONS.map(({ cols, icon, label }) => (
            <button key={cols} onClick={() => setColumns(cols)} title={label} style={colBtnStyle(columns === cols)}>
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
            fontSize: 12,
            fontWeight: 700,
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
        >
          PRs
        </button>
        {/* Stats — amber */}
        <button
          onClick={() => { setShowStats((v) => !v); setShowHistory(false); setShowClaudeSessions(false); setShowPRs(false); }}
          style={drawerBtnStyle(showStats, "#fbbf24", "rgba(251,191,36,0.1)", "rgba(251,191,36,0.35)")}
        >
          Stats
        </button>
        {/* Claude Sessions — purple */}
        <button
          onClick={() => { setShowClaudeSessions((v) => !v); setShowHistory(false); setShowStats(false); setShowPRs(false); }}
          style={drawerBtnStyle(showClaudeSessions, "#c084fc", "rgba(192,132,252,0.1)", "rgba(192,132,252,0.35)")}
        >
          Claude Sessions
        </button>
        {/* History — cyan */}
        <button
          onClick={() => { setShowHistory((v) => !v); setShowClaudeSessions(false); setShowStats(false); setShowPRs(false); }}
          style={drawerBtnStyle(showHistory, "#22d3ee", "rgba(34,211,238,0.1)", "rgba(34,211,238,0.35)")}
        >
          History
        </button>

        <span style={{ fontSize: 11, color: "rgba(0,210,120,0.28)", marginLeft: 8, fontFamily: "'DM Mono', monospace" }}>
          {panels.length} session{panels.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Worktree confirmation modal */}
      {worktreeConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(5, 15, 9, 0.72)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "rgba(12, 30, 18, 0.92)",
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
            border: "1px solid rgba(0, 255, 135, 0.18)",
            borderRadius: 16,
            padding: "24px 28px",
            width: 420,
            boxShadow: "0 8px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,255,135,0.06)",
          }}>
            <div style={{ color: "#e2fff3", fontWeight: 700, fontSize: 15, marginBottom: 8, fontFamily: "'Syne', sans-serif" }}>
              Create worktree?
            </div>
            <div style={{ color: "rgba(0,240,128,0.45)", fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
              No existing worktree found for{" "}
              <span style={{ color: "#00f080", fontFamily: "'DM Mono', monospace" }}>{worktreeConfirm.branchName}</span>
              {". A new one will be created at:"}
            </div>
            <div style={{
              background: "rgba(0, 255, 135, 0.05)",
              border: "1px solid rgba(0, 255, 135, 0.14)",
              borderRadius: 8,
              padding: "8px 12px", marginBottom: 20,
              color: "#00f080", fontSize: 11, fontFamily: "'DM Mono', monospace", wordBreak: "break-all",
            }}>
              {worktreeConfirm.wtPath}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setWorktreeConfirm(null)}
                style={{
                  background: "rgba(0, 255, 135, 0.05)",
                  border: "1px solid rgba(0, 255, 135, 0.14)",
                  borderRadius: 8,
                  color: "rgba(0,240,128,0.45)", cursor: "pointer", fontSize: 12, fontWeight: 600,
                  padding: "7px 18px", fontFamily: "'Syne', sans-serif",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmWorktree}
                className="btn-animated-gradient"
                style={{
                  borderRadius: 8,
                  cursor: "pointer", fontSize: 12, fontWeight: 700,
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
          gap: 4,
          padding: 4,
          minHeight: 0,
          overflowY: "auto",
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
