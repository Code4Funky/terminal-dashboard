import { useState, useEffect, useRef } from "react";
import { TerminalPanel } from "./TerminalPanel";
import { HistoryDrawer } from "./HistoryDrawer";
import { StatsDrawer } from "./StatsDrawer";
import { PRsDrawer } from "./PRsDrawer";
import { NotesDrawer } from "./NotesDrawer";
import { ClaudeAgentsDrawer } from "./ClaudeAgentsDrawer";
import { useTheme } from "../ThemeContext";

interface PanelState {
  id: string;
  sessionId: string;
  number: number;
  title: string;
  cwd?: string;
  gitBranch?: string;
}

type Columns = 1 | 2 | 3 | 4;
type SidePanel = "prs" | "stats" | "history" | "notes" | "claude-agents";

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
  const { theme, toggleTheme } = useTheme();
  const t = theme;

  const [columns, setColumns] = useState<Columns>(1);
  const [panels, setPanels] = useState<PanelState[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<SidePanel | null>("prs");
  const togglePanel = (panel: SidePanel) => setActivePanel((v) => (v === panel ? null : panel));
  const [worktreeConfirm, setWorktreeConfirm] = useState<{ repoName: string; branchName: string; wtPath: string } | null>(null);
  const [dirtyConfirm, setDirtyConfirm] = useState<{ repoName: string; branchName: string; files: string[] } | null>(null);
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
    try {
      const { exists, path } = await window.terminal.checkWorktree(repoName, branchName);
      if (exists && path) {
        openBranchInTerminal(repoName, branchName, path);
      } else {
        // No worktree — open the main repo and checkout the branch.
        // First check if there are uncommitted changes.
        const { dirty, files } = await window.terminal.checkGitDirty(repoName);
        if (dirty) {
          setDirtyConfirm({ repoName, branchName, files });
        } else {
          const repoPath = `$HOME/Documents/GitHub/${repoName}`;
          const cmd = `cd "${repoPath}" && git checkout ${branchName}`;
          const { sessionId, number } = await window.terminal.create(220, 50, undefined, cmd);
          const panel: PanelState = { id: sessionId, sessionId, number, title: `${repoName}:${branchName}` };
          setPanels((prev) => { const next = [...prev, panel]; savePanels(next); return next; });
          setFocusedId(sessionId);
          window.terminal.setFocused(sessionId);
        }
      }
    } catch (e) {
      console.error("handleOpenBranchTerminal failed", e);
    }
  };

  const handleDirtyStashAndCheckout = async () => {
    if (!dirtyConfirm) return;
    const { repoName, branchName } = dirtyConfirm;
    setDirtyConfirm(null);
    const repoPath = `$HOME/Documents/GitHub/${repoName}`;
    const cmd = `cd "${repoPath}" && git stash && git checkout ${branchName}`;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, cmd);
    const panel: PanelState = { id: sessionId, sessionId, number, title: `${repoName}:${branchName}` };
    setPanels((prev) => { const next = [...prev, panel]; savePanels(next); return next; });
    setFocusedId(sessionId);
    window.terminal.setFocused(sessionId);
  };

  const handleOpenRepoTerminal = async (repoName: string, branchName: string) => {
    const repoPath = `$HOME/Documents/GitHub/${repoName}`;
    const cmd = `cd "${repoPath}" && git checkout ${branchName}`;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, cmd);
    const panel: PanelState = { id: sessionId, sessionId, number, title: `${repoName}:${branchName}` };
    setPanels((prev) => { const next = [...prev, panel]; savePanels(next); return next; });
    setFocusedId(sessionId);
    window.terminal.setFocused(sessionId);
  };

  const handleOpenSessionTerminal = async (resolvedPath: string) => {
    const name = resolvedPath.split("/").filter(Boolean).pop() ?? "session";
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${resolvedPath}"`);
    const panel: PanelState = { id: sessionId, sessionId, number, title: name };
    setPanels((prev) => { const next = [...prev, panel]; savePanels(next); return next; });
    setFocusedId(sessionId);
    window.terminal.setFocused(sessionId);
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
    background: active ? t.surface3 : "none",
    border: `1px solid ${active ? t.borderMid : t.borderSubtle}`,
    borderRadius: 4,
    color: active ? t.label1 : t.label3,
    cursor: "pointer" as const,
    fontSize: 14,
    padding: "2px 8px",
    transition: "all 0.15s",
  });

  const drawerBtnStyle = (active: boolean, activeColor: string, activeBg: string, activeBorder: string) => ({
    background: active ? activeBg : "none",
    border: `1px solid ${active ? activeBorder : t.borderSubtle}`,
    borderRadius: 6,
    color: active ? activeColor : t.label3,
    cursor: "pointer" as const,
    fontSize: 12,
    fontWeight: 600 as const,
    padding: "4px 12px",
    transition: "all 0.15s",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  });

  const SYS = { fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: t.bg, overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center",
        gap: 8, padding: "6px 12px 6px 80px",
        background: t.surface1,
        borderBottom: `1px solid ${t.border}`,
        flexShrink: 0,
        WebkitAppRegion: "drag" as const,
        position: "relative", zIndex: 10,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: t.label1, marginRight: 8, letterSpacing: 0.4, ...SYS }}>
          Terminal Dashboard
        </span>

        <div style={{ display: "flex", gap: 4, marginRight: 8, WebkitAppRegion: "no-drag" as const }}>
          {COLUMN_OPTIONS.map(({ cols, icon, label }) => (
            <button
              key={cols} onClick={() => setColumns(cols)} title={label} style={colBtnStyle(columns === cols)}
              onMouseEnter={(e) => { if (columns !== cols) { e.currentTarget.style.background = t.surface2; e.currentTarget.style.borderColor = t.borderMid; e.currentTarget.style.color = t.label2; }}}
              onMouseLeave={(e) => { if (columns !== cols) { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = t.borderSubtle; e.currentTarget.style.color = t.label3; }}}
            >
              {icon}
            </button>
          ))}
        </div>

        <button
          onClick={handleAddPanel}
          style={{
            borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700,
            padding: "4px 14px", WebkitAppRegion: "no-drag" as const, letterSpacing: 0.3,
            background: t.blue, border: "none", color: "#FFFFFF", ...SYS,
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.82")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          + New Terminal
        </button>

        <div style={{ flex: 1 }} />

        {/* Tab buttons */}
        <div style={{ display: "flex", gap: 4, WebkitAppRegion: "no-drag" as const }}>
          <button
            onClick={() => togglePanel("prs")}
            style={drawerBtnStyle(activePanel === "prs", t.blue, t.isDark ? "rgba(10,132,255,0.18)" : "rgba(0,122,255,0.12)", t.isDark ? "rgba(10,132,255,0.5)" : "rgba(0,122,255,0.4)")}
            onMouseEnter={(e) => { if (activePanel !== "prs") { e.currentTarget.style.color = t.blue; e.currentTarget.style.borderColor = t.isDark ? "rgba(10,132,255,0.35)" : "rgba(0,122,255,0.3)"; }}}
            onMouseLeave={(e) => { if (activePanel !== "prs") { e.currentTarget.style.color = t.label3; e.currentTarget.style.borderColor = t.borderSubtle; }}}
          >GitHub</button>
          <button
            onClick={() => togglePanel("stats")}
            style={drawerBtnStyle(activePanel === "stats", t.orange, t.isDark ? "rgba(255,159,10,0.15)" : "rgba(255,149,0,0.1)", t.isDark ? "rgba(255,159,10,0.5)" : "rgba(255,149,0,0.4)")}
            onMouseEnter={(e) => { if (activePanel !== "stats") { e.currentTarget.style.color = t.orange; e.currentTarget.style.borderColor = t.isDark ? "rgba(255,159,10,0.35)" : "rgba(255,149,0,0.3)"; }}}
            onMouseLeave={(e) => { if (activePanel !== "stats") { e.currentTarget.style.color = t.label3; e.currentTarget.style.borderColor = t.borderSubtle; }}}
          >Stats</button>
          <button
            onClick={() => togglePanel("history")}
            style={drawerBtnStyle(activePanel === "history", t.teal, t.isDark ? "rgba(90,200,250,0.15)" : "rgba(50,173,230,0.1)", t.isDark ? "rgba(90,200,250,0.5)" : "rgba(50,173,230,0.4)")}
            onMouseEnter={(e) => { if (activePanel !== "history") { e.currentTarget.style.color = t.teal; e.currentTarget.style.borderColor = t.isDark ? "rgba(90,200,250,0.35)" : "rgba(50,173,230,0.3)"; }}}
            onMouseLeave={(e) => { if (activePanel !== "history") { e.currentTarget.style.color = t.label3; e.currentTarget.style.borderColor = t.borderSubtle; }}}
          >History</button>
          <button
            onClick={() => togglePanel("notes")}
            style={drawerBtnStyle(activePanel === "notes", t.purple, t.isDark ? "rgba(191,90,242,0.15)" : "rgba(175,82,222,0.1)", t.isDark ? "rgba(191,90,242,0.5)" : "rgba(175,82,222,0.4)")}
            onMouseEnter={(e) => { if (activePanel !== "notes") { e.currentTarget.style.color = t.purple; e.currentTarget.style.borderColor = t.isDark ? "rgba(191,90,242,0.35)" : "rgba(175,82,222,0.3)"; }}}
            onMouseLeave={(e) => { if (activePanel !== "notes") { e.currentTarget.style.color = t.label3; e.currentTarget.style.borderColor = t.borderSubtle; }}}
          >Notes</button>
          <button
            onClick={() => togglePanel("claude-agents")}
            style={drawerBtnStyle(activePanel === "claude-agents", t.teal, t.isDark ? "rgba(90,200,250,0.15)" : "rgba(50,173,230,0.1)", t.isDark ? "rgba(90,200,250,0.5)" : "rgba(50,173,230,0.4)")}
            onMouseEnter={(e) => { if (activePanel !== "claude-agents") { e.currentTarget.style.color = t.teal; e.currentTarget.style.borderColor = t.isDark ? "rgba(90,200,250,0.35)" : "rgba(50,173,230,0.3)"; }}}
            onMouseLeave={(e) => { if (activePanel !== "claude-agents") { e.currentTarget.style.color = t.label3; e.currentTarget.style.borderColor = t.borderSubtle; }}}
          >Claude</button>
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={t.isDark ? "Switch to light mode" : "Switch to dark mode"}
          style={{
            background: "none", border: `1px solid ${t.borderSubtle}`,
            borderRadius: 6, color: t.label3, cursor: "pointer",
            fontSize: 14, padding: "3px 8px", lineHeight: 1,
            WebkitAppRegion: "no-drag" as const, transition: "all 0.15s", marginLeft: 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = t.label1; e.currentTarget.style.borderColor = t.borderMid; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = t.label3; e.currentTarget.style.borderColor = t.borderSubtle; }}
        >
          {t.isDark ? "☀" : "☾"}
        </button>

        <span style={{ fontSize: 11, color: t.label4, marginLeft: 4, fontFamily: "monospace" }}>
          {panels.length} session{panels.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Worktree confirmation modal */}
      {worktreeConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: t.surface1, border: `1px solid ${t.border}`,
            borderRadius: 16, padding: "24px 28px", width: 420,
            boxShadow: "0 8px 48px rgba(0,0,0,0.4)",
          }}>
            <div style={{ color: t.label1, fontWeight: 700, fontSize: 15, marginBottom: 8, ...SYS }}>
              Create worktree?
            </div>
            <div style={{ color: t.label2, fontSize: 12, marginBottom: 16, lineHeight: 1.6, ...SYS }}>
              No existing worktree found for{" "}
              <span style={{ color: t.purple, fontFamily: "monospace" }}>{worktreeConfirm.branchName}</span>
              {". A new one will be created at:"}
            </div>
            <div style={{
              background: t.surface2, border: `1px solid ${t.borderMid}`,
              borderRadius: 8, padding: "8px 12px", marginBottom: 20,
              color: t.teal, fontSize: 11, fontFamily: "monospace", wordBreak: "break-all",
            }}>
              {worktreeConfirm.wtPath}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setWorktreeConfirm(null)}
                style={{
                  background: t.surface2, border: `1px solid ${t.border}`,
                  borderRadius: 8, color: t.label2, cursor: "pointer",
                  fontSize: 12, fontWeight: 600, padding: "7px 18px", ...SYS,
                }}
              >Cancel</button>
              <button
                onClick={handleConfirmWorktree}
                style={{
                  background: t.blue, border: "none", borderRadius: 8,
                  color: "#FFFFFF", cursor: "pointer",
                  fontSize: 12, fontWeight: 700, padding: "7px 20px", ...SYS,
                }}
              >Create &amp; Open</button>
            </div>
          </div>
        </div>
      )}

      {/* Dirty files confirmation modal */}
      {dirtyConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: t.surface1, border: `1px solid ${t.border}`,
            borderRadius: 16, padding: "24px 28px", width: 440,
            boxShadow: "0 8px 48px rgba(0,0,0,0.4)",
          }}>
            <div style={{ color: t.orange, fontWeight: 700, fontSize: 15, marginBottom: 8, ...SYS }}>
              Uncommitted changes detected
            </div>
            <div style={{ color: t.label2, fontSize: 12, marginBottom: 12, lineHeight: 1.6, ...SYS }}>
              <span style={{ color: t.label1 }}>{dirtyConfirm.repoName}</span> has unsaved changes.
              Stage or stash them before checking out{" "}
              <span style={{ color: t.purple, fontFamily: "monospace" }}>{dirtyConfirm.branchName}</span>.
            </div>
            <div style={{
              background: t.surface2, border: `1px solid ${t.borderMid}`,
              borderRadius: 8, padding: "8px 12px", marginBottom: 20,
              maxHeight: 120, overflowY: "auto",
            }}>
              {dirtyConfirm.files.slice(0, 20).map((f) => (
                <div key={f} style={{ fontSize: 11, fontFamily: "monospace", color: t.orange, lineHeight: 1.7 }}>{f}</div>
              ))}
              {dirtyConfirm.files.length > 20 && (
                <div style={{ fontSize: 11, color: t.label4, fontFamily: "monospace" }}>
                  …and {dirtyConfirm.files.length - 20} more
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setDirtyConfirm(null)}
                style={{
                  background: t.surface2, border: `1px solid ${t.border}`,
                  borderRadius: 8, color: t.label2, cursor: "pointer",
                  fontSize: 12, fontWeight: 600, padding: "7px 18px", ...SYS,
                }}
              >Cancel</button>
              <button
                onClick={handleDirtyStashAndCheckout}
                style={{
                  background: t.orange, border: "none", borderRadius: 8,
                  color: "#FFFFFF", cursor: "pointer",
                  fontSize: 12, fontWeight: 700, padding: "7px 20px", ...SYS,
                }}
              >Stash &amp; Checkout</button>
            </div>
          </div>
        </div>
      )}

      {/* Content row */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden", position: "relative", zIndex: 1 }}>
        <div style={{
          flex: 1, display: "grid",
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

        {activePanel === "prs" && <PRsDrawer onClose={() => setActivePanel(null)} onOpenTerminal={handleOpenBranchTerminal} onOpenRepo={handleOpenRepoTerminal} />}
        {activePanel === "stats" && <StatsDrawer onClose={() => setActivePanel(null)} onOpenSession={handleOpenSessionTerminal} />}
        {activePanel === "history" && (
          <HistoryDrawer openNumbers={panels.map((p) => p.number)} onReopen={handleReopen} onClose={() => setActivePanel(null)} />
        )}
        {activePanel === "notes" && <NotesDrawer onClose={() => setActivePanel(null)} />}
        {activePanel === "claude-agents" && <ClaudeAgentsDrawer onClose={() => setActivePanel(null)} onOpenTerminal={handleOpenSessionTerminal} />}
      </div>
    </div>
  );
}
