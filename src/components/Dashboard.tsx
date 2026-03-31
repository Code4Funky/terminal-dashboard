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

  const colBtnActive = (active: boolean) => ({
    background: active ? "rgba(139, 92, 246, 0.12)" : "none",
    border: active ? "1px solid rgba(139, 92, 246, 0.45)" : "1px solid rgba(139, 92, 246, 0.1)",
    borderRadius: 4,
    color: active ? "#a78bfa" : "#64748b",
    cursor: "pointer" as const,
    fontSize: 14,
    padding: "2px 8px",
    transition: "all 0.15s",
  });

  const drawerBtnStyle = (active: boolean, accentPurple: boolean) => ({
    background: active
      ? (accentPurple ? "rgba(139, 92, 246, 0.12)" : "rgba(20, 184, 166, 0.1)")
      : "none",
    border: active
      ? (accentPurple ? "1px solid rgba(139, 92, 246, 0.4)" : "1px solid rgba(20, 184, 166, 0.4)")
      : "1px solid rgba(139, 92, 246, 0.1)",
    borderRadius: 6,
    color: active ? (accentPurple ? "#a78bfa" : "#2dd4bf") : "#64748b",
    cursor: "pointer" as const,
    fontSize: 12,
    fontWeight: 600 as const,
    padding: "4px 12px",
    WebkitAppRegion: "no-drag" as const,
    transition: "all 0.15s",
    fontFamily: "'Syne', sans-serif",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#070714", position: "relative", overflow: "hidden" }}>
      {/* Ambient orbs */}
      <div style={{
        position: "fixed", top: "-15%", left: "-8%",
        width: 600, height: 600, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 65%)",
        pointerEvents: "none", zIndex: 0,
        animation: "orbFloat1 12s ease-in-out infinite",
      }} />
      <div style={{
        position: "fixed", bottom: "-20%", right: "-5%",
        width: 700, height: 700, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(13,148,136,0.13) 0%, transparent 65%)",
        pointerEvents: "none", zIndex: 0,
        animation: "orbFloat2 16s ease-in-out infinite",
      }} />
      <div style={{
        position: "fixed", top: "45%", right: "22%",
        width: 320, height: 320, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(139,92,246,0.07) 0%, transparent 70%)",
        pointerEvents: "none", zIndex: 0,
      }} />

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px 6px 80px",
          background: "rgba(8, 6, 22, 0.78)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          borderBottom: "1px solid rgba(139, 92, 246, 0.14)",
          flexShrink: 0,
          WebkitAppRegion: "drag" as const,
          boxShadow: "0 1px 0 rgba(124, 58, 237, 0.06), 0 2px 12px rgba(0,0,0,0.3)",
          position: "relative",
          zIndex: 10,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginRight: 8, letterSpacing: 0.4, fontFamily: "'Syne', sans-serif" }}>
          Terminal Dashboard
        </span>

        <div style={{ display: "flex", gap: 4, marginRight: 8, WebkitAppRegion: "no-drag" as const }}>
          {COLUMN_OPTIONS.map(({ cols, icon, label }) => (
            <button key={cols} onClick={() => setColumns(cols)} title={label} style={colBtnActive(columns === cols)}>
              {icon}
            </button>
          ))}
        </div>

        <button
          onClick={handleAddPanel}
          className="btn-animated-gradient"
          style={{
            borderRadius: 6,
            color: "#fff",
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

        <button onClick={() => { setShowPRs((v) => !v); setShowHistory(false); setShowClaudeSessions(false); setShowStats(false); }} style={drawerBtnStyle(showPRs, true)}>
          PRs
        </button>
        <button onClick={() => { setShowStats((v) => !v); setShowHistory(false); setShowClaudeSessions(false); setShowPRs(false); }} style={drawerBtnStyle(showStats, false)}>
          Stats
        </button>
        <button onClick={() => { setShowClaudeSessions((v) => !v); setShowHistory(false); setShowStats(false); setShowPRs(false); }} style={drawerBtnStyle(showClaudeSessions, true)}>
          Claude Sessions
        </button>
        <button onClick={() => { setShowHistory((v) => !v); setShowClaudeSessions(false); setShowStats(false); setShowPRs(false); }} style={drawerBtnStyle(showHistory, false)}>
          History
        </button>

        <span style={{ fontSize: 11, color: "#475569", marginLeft: 8, fontFamily: "'DM Mono', monospace" }}>
          {panels.length} session{panels.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Worktree creation confirmation modal */}
      {worktreeConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0, 0, 0, 0.65)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "rgba(10, 8, 28, 0.92)",
            backdropFilter: "blur(32px)",
            WebkitBackdropFilter: "blur(32px)",
            border: "1px solid rgba(139, 92, 246, 0.25)",
            borderRadius: 16,
            padding: "24px 28px",
            width: 420,
            boxShadow: "0 8px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.08)",
          }}>
            <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 15, marginBottom: 8, fontFamily: "'Syne', sans-serif" }}>
              Create worktree?
            </div>
            <div style={{ color: "#64748b", fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
              No existing worktree found for{" "}
              <span style={{ color: "#a78bfa", fontFamily: "'DM Mono', monospace" }}>{worktreeConfirm.branchName}</span>
              {". A new one will be created at:"}
            </div>
            <div style={{
              background: "rgba(7, 5, 18, 0.8)",
              border: "1px solid rgba(139, 92, 246, 0.15)",
              borderRadius: 8,
              padding: "8px 12px", marginBottom: 20,
              color: "#2dd4bf", fontSize: 11, fontFamily: "'DM Mono', monospace", wordBreak: "break-all",
            }}>
              {worktreeConfirm.wtPath}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setWorktreeConfirm(null)}
                style={{
                  background: "rgba(15, 12, 35, 0.6)",
                  border: "1px solid rgba(139, 92, 246, 0.15)",
                  borderRadius: 8,
                  color: "#64748b", cursor: "pointer", fontSize: 12, fontWeight: 600,
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
                  color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700,
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
        {/* Panel grid */}
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gridAutoRows: `calc((100vh - 41px) / ${Math.ceil(panels.length / columns)})`,
            gap: 4,
            padding: 4,
            minHeight: 0,
            overflowY: "auto",
          }}
        >
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

        {showPRs && (
          <PRsDrawer onClose={() => setShowPRs(false)} onOpenTerminal={handleOpenBranchTerminal} />
        )}
        {showStats && (
          <StatsDrawer onClose={() => setShowStats(false)} />
        )}
        {showHistory && (
          <HistoryDrawer
            openNumbers={panels.map((p) => p.number)}
            onReopen={handleReopen}
            onClose={() => setShowHistory(false)}
          />
        )}
        {showClaudeSessions && (
          <ClaudeSessionsDrawer onClose={() => setShowClaudeSessions(false)} />
        )}
      </div>
    </div>
  );
}
