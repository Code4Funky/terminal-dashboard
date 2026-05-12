import { useState, useEffect, useRef, Component } from "react";
import type { ReactNode } from "react";
import { TerminalPanel } from "./TerminalPanel";
import { HistoryDrawer } from "./HistoryDrawer";
import { StatsDrawer } from "./StatsDrawer";
import { NotesDrawer } from "./NotesDrawer";
import { ClaudeAgentsDrawer } from "./ClaudeAgentsDrawer";
import { KBChatDrawer } from "./KBChatDrawer";
import { RepoSidebar, SelectedPR, TerminalTab } from "./RepoSidebar";
import { NewTerminalModal } from "./NewTerminalModal";
import { DiffDrawer } from "./DiffDrawer";
import { useTheme } from "../ThemeContext";
import { SYS_FONT } from "../theme";

interface PanelState {
  id: string;
  sessionId: string;
  number: number;
  title: string;
  cwd?: string;
  gitBranch?: string;
}

type SidePanel = "stats" | "history" | "notes" | "claude-agents" | "kb-chat";

class KBChatErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, background: "#1c1c1e", color: "#FF453A", fontSize: 11, fontFamily: "monospace", width: 400, flexShrink: 0, overflowY: "auto" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>KB Chat crashed:</div>
          <div style={{ color: "#FF9F0A", marginBottom: 8, wordBreak: "break-word" }}>{this.state.error.message}</div>
          <pre style={{ fontSize: 10, color: "rgba(235,235,245,0.45)", whiteSpace: "pre-wrap", margin: 0 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Single-quote a string for safe use as a shell token.
// Escapes embedded single quotes as: ' → '\''
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// Strip characters invalid in filesystem paths (used for worktree directory names).
function safeDirName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function savePanels(panels: PanelState[]) {
  window.terminal.savePanels(
    panels.map((p) => ({ number: p.number, title: p.title }))
  );
}

export function Dashboard() {
  const { theme, toggleTheme } = useTheme();
  const t = theme;

  const [panels, setPanels] = useState<PanelState[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<SidePanel | null>(null);
  const [selectedPR, setSelectedPR] = useState<SelectedPR | null>(null);
  const [selectedRepoTree, setSelectedRepoTree] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalRepos, setModalRepos] = useState<{ name: string }[]>([]);
  const togglePanel = (panel: SidePanel) => setActivePanel((v) => (v === panel ? null : panel));
  const handlePanelToggle = (panel: SidePanel) => {
    if (panel === "kb-chat" && activePanel !== "kb-chat") setSplitMode(true);
    togglePanel(panel);
  };
  const [zenMode, setZenMode] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [termFitKey, setTermFitKey] = useState(0);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const splitDragRef = useRef<{ startX: number; startRatio: number; totalWidth: number } | null>(null);
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
      const toRestore = lastPanels.length > 0 ? lastPanels.slice(0, 8) : null;
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

  const addPanel = (sessionId: string, number: number, title: string) => {
    const panel: PanelState = { id: sessionId, sessionId, number, title };
    setPanels((prev) => { const next = [...prev, panel]; savePanels(next); return next; });
    setFocusedId(sessionId);
    window.terminal.setFocused(sessionId);
  };

  const handleRename = (panelId: string, newTitle: string) => {
    setPanels((prev) => {
      const next = prev.map((p) => p.id === panelId ? { ...p, title: newTitle } : p);
      savePanels(next);
      return next;
    });
  };

  const handleAddPanel = async () => {
    const { sessionId, number } = await window.terminal.create(220, 50);
    addPanel(sessionId, number, `terminal ${number}`);
  };

  const openBranchInTerminal = async (repoName: string, branchName: string, wtPath: string) => {
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${wtPath}"`);
    addPanel(sessionId, number, `${repoName}:${branchName}`);
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
          const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${repoPath}" && git checkout ${shellQuote(branchName)}`);
          addPanel(sessionId, number, `${repoName}:${branchName}`);
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
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${repoPath}" && git stash && git checkout ${shellQuote(branchName)}`);
    addPanel(sessionId, number, `${repoName}:${branchName}`);
  };

  const handleOpenRepoTerminal = async (repoName: string, branchName: string) => {
    const repoPath = `$HOME/Documents/GitHub/${repoName}`;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${repoPath}" && git checkout ${shellQuote(branchName)}`);
    addPanel(sessionId, number, `${repoName}:${branchName}`);
  };

  const handleRunClaudeAction = async (repoName: string, branchName: string, claudeCmd: string) => {
    try {
      const { exists, path } = await window.terminal.checkWorktree(repoName, branchName);
      let cmd: string;
      if (exists && path) {
        cmd = `cd "${path}" && ${claudeCmd}`;
      } else {
        // Auto-create an isolated worktree so parallel branch runs never conflict
        const wtPath = `$HOME/Documents/GitHub/${repoName}-worktrees/${safeDirName(branchName)}`;
        cmd = `git -C "$HOME/Documents/GitHub/${repoName}" worktree add "${wtPath}" ${shellQuote(branchName)} 2>/dev/null || true && cd "${wtPath}" && ${claudeCmd}`;
      }
      const { sessionId, number } = await window.terminal.create(220, 50, undefined, cmd);
      addPanel(sessionId, number, `${repoName}:${branchName}`);
    } catch (e) {
      console.error("handleRunClaudeAction failed", e);
    }
  };

  const handleOpenInRepo = async (repoName: string) => {
    const repoPath = `$HOME/Documents/GitHub/${repoName}`;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${repoPath}"`);
    addPanel(sessionId, number, repoName);
  };

  const handleOpenSessionTerminal = async (resolvedPath: string) => {
    const name = resolvedPath.split("/").filter(Boolean).pop() ?? "session";
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, `cd "${resolvedPath}"`);
    addPanel(sessionId, number, name);
  };

  const handleConfirmWorktree = async () => {
    if (!worktreeConfirm) return;
    const { repoName, branchName, wtPath } = worktreeConfirm;
    setWorktreeConfirm(null);
    const createCmd =
      `git -C "$HOME/Documents/GitHub/${repoName}" worktree add "${wtPath}" ${shellQuote(branchName)} && cd "${wtPath}"`;
    const { sessionId, number } = await window.terminal.create(220, 50, undefined, createCmd);
    addPanel(sessionId, number, `${repoName}:${branchName}`);
  };

  const handleReopen = async (num: number) => {
    const { sessionId } = await window.terminal.create(220, 50, num);
    addPanel(sessionId, num, `terminal ${num}`);
  };

  const handleClose = (panelId: string) => {
    if (panels.length <= 1) return;
    const panel = panels.find((p) => p.id === panelId);
    if (panel) window.terminal.close(panel.sessionId);
    setPanels((prev) => {
      const next = prev.filter((p) => p.id !== panelId);
      savePanels(next);
      if (focusedId === panelId) setFocusedId(next.at(-1)?.id ?? null);
      return next;
    });
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const fromTerminal = (e.target as HTMLElement).classList?.contains("xterm-helper-textarea");
      if (e.metaKey && !e.shiftKey && !e.altKey) {
        if (e.key === "t") { e.preventDefault(); handleAddPanel(); return; }
        if (e.key === "\\") { e.preventDefault(); setZenMode((v) => !v); return; }
      }
      if (e.metaKey && e.shiftKey && !e.altKey) {
        if (e.key === "k") {
          e.preventDefault();
          if (activePanel !== "kb-chat") {
            setActivePanel("kb-chat");
            setSplitMode(true);
          } else {
            setSplitMode((v) => !v);
          }
          return;
        }
        const TABS: SidePanel[] = ["stats", "history", "notes", "claude-agents", "kb-chat"];
        const idx = parseInt(e.key) - 1;
        if (idx >= 0 && idx < TABS.length) {
          e.preventDefault();
          handlePanelToggle(TABS[idx]);
          return;
        }
      }
      if (e.ctrlKey && e.key === "w" && !fromTerminal) {
        e.preventDefault();
        if (focusedId) handleClose(focusedId);
      }
    };
    window.addEventListener("keydown", handleKey, { capture: true });
    return () => window.removeEventListener("keydown", handleKey, { capture: true });
  }, [focusedId, panels]);

  // Reset split mode when leaving KB chat
  useEffect(() => {
    if (activePanel !== "kb-chat") setSplitMode(false);
  }, [activePanel]);

  // Refit terminal immediately when split mode changes, and again after layout settles
  useEffect(() => {
    setTermFitKey((k) => k + 1);
    const id = setTimeout(() => setTermFitKey((k) => k + 1), 100);
    return () => clearTimeout(id);
  }, [splitMode]);

  const handleSplitDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const totalWidth = (e.currentTarget.parentElement?.clientWidth ?? 1000) - 4;
    splitDragRef.current = { startX: e.clientX, startRatio: splitRatio, totalWidth };
    const onMove = (ev: MouseEvent) => {
      if (!splitDragRef.current) return;
      const dx = ev.clientX - splitDragRef.current.startX;
      setSplitRatio(Math.max(0.25, Math.min(0.75, splitDragRef.current.startRatio + dx / splitDragRef.current.totalWidth)));
    };
    const onUp = () => {
      splitDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };



  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: t.bg, overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center",
        gap: 8, padding: "6px 12px 6px 80px",
        background: t.surface1,
        backdropFilter: t.backdropFilter,
        WebkitBackdropFilter: t.backdropFilter,
        borderBottom: `1px solid ${t.border}`,
        flexShrink: 0,
        WebkitAppRegion: "drag" as const,
        position: "relative", zIndex: 10,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: t.label1, marginRight: 8, letterSpacing: 0.4, ...SYS_FONT }}>
          Dev Space
        </span>

        <button
          onClick={() => setShowModal(true)}
          style={{
            borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700,
            padding: "4px 14px", WebkitAppRegion: "no-drag" as const, letterSpacing: 0.3,
            background: t.blue, border: "none", color: "#FFFFFF", ...SYS_FONT,
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.82")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          title="New Terminal (⌘T)"
        >
          + New Terminal
        </button>

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setZenMode((v) => !v)}
          title={zenMode ? "Show sidebar (⌘\\)" : "Hide sidebar (⌘\\)"}
          style={{
            background: "none", border: `1px solid ${t.borderSubtle}`,
            borderRadius: 6, color: zenMode ? t.blue : t.label3, cursor: "pointer",
            fontSize: 13, padding: "3px 7px", lineHeight: 1,
            WebkitAppRegion: "no-drag" as const, transition: "all 0.15s", marginRight: 6,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = t.label1; e.currentTarget.style.borderColor = t.borderMid; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = zenMode ? t.blue : t.label3; e.currentTarget.style.borderColor = t.borderSubtle; }}
        >{zenMode ? "▷" : "◁"}</button>

        <span style={{ fontSize: 11, color: t.label3, fontFamily: "monospace", WebkitAppRegion: "no-drag" as const }}>
          {panels.length} session{panels.length !== 1 ? "s" : ""}
        </span>
      </div>

      {showModal && (
        <NewTerminalModal
          onClose={() => setShowModal(false)}
          onOpenRoot={handleAddPanel}
          onOpenInRepo={handleOpenInRepo}
          repos={modalRepos}
        />
      )}

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
            <div style={{ color: t.label1, fontWeight: 700, fontSize: 15, marginBottom: 8, ...SYS_FONT }}>
              Create worktree?
            </div>
            <div style={{ color: t.label2, fontSize: 12, marginBottom: 16, lineHeight: 1.6, ...SYS_FONT }}>
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
                  fontSize: 12, fontWeight: 600, padding: "7px 18px", ...SYS_FONT,
                }}
              >Cancel</button>
              <button
                onClick={handleConfirmWorktree}
                style={{
                  background: t.blue, border: "none", borderRadius: 8,
                  color: "#FFFFFF", cursor: "pointer",
                  fontSize: 12, fontWeight: 700, padding: "7px 20px", ...SYS_FONT,
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
            <div style={{ color: t.orange, fontWeight: 700, fontSize: 15, marginBottom: 8, ...SYS_FONT }}>
              Uncommitted changes detected
            </div>
            <div style={{ color: t.label2, fontSize: 12, marginBottom: 12, lineHeight: 1.6, ...SYS_FONT }}>
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
                  fontSize: 12, fontWeight: 600, padding: "7px 18px", ...SYS_FONT,
                }}
              >Cancel</button>
              <button
                onClick={handleDirtyStashAndCheckout}
                style={{
                  background: t.orange, border: "none", borderRadius: 8,
                  color: "#FFFFFF", cursor: "pointer",
                  fontSize: 12, fontWeight: 700, padding: "7px 20px", ...SYS_FONT,
                }}
              >Stash &amp; Checkout</button>
            </div>
          </div>
        </div>
      )}

      {/* Content row */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden", position: "relative", zIndex: 1 }}>
        {!zenMode && (
          <RepoSidebar
            tabs={panels.map((p): TerminalTab => ({ id: p.id, title: p.title, cwd: p.cwd, gitBranch: p.gitBranch }))}
            focusedId={focusedId}
            onFocusTab={(id) => { setFocusedId(id); const p = panels.find((x) => x.id === id); if (p) window.terminal.setFocused(p.sessionId); }}
            onCloseTab={handleClose}
            onAddTab={() => setShowModal(true)}
            selected={selectedPR}
            onSelectPR={(pr) => { setSelectedPR(pr); if (pr) setSelectedRepoTree(null); }}
            onOpenTerminal={handleOpenBranchTerminal}
            onOpenRepoTerminal={handleOpenInRepo}
            onSelectRepoTree={(name) => { setSelectedRepoTree(name); setSelectedPR(null); }}
            onRunClaudeAction={(repo, branch, cmd) => { handleRunClaudeAction(repo, branch, cmd); }}
            onReposLoaded={setModalRepos}
            onCheckoutBranch={(repoName, branch) => { window.terminal.writeToFocusedTerminal(`cd ~/Documents/GitHub/${repoName} && git checkout ${branch}\n`); }}
          />
        )}
        <div style={{
          flex: splitMode && activePanel === "kb-chat" ? splitRatio : 1,
          minWidth: splitMode && activePanel === "kb-chat" ? 300 : undefined,
          display: "flex", flexDirection: "column",
          minHeight: 0, overflow: "hidden",
        }}>
          {panels.map((panel) => (
            <div
              key={panel.id}
              style={{ display: panel.id === focusedId ? "flex" : "none", flex: 1, minHeight: 0, padding: 4 }}
            >
              <TerminalPanel
                sessionId={panel.sessionId}
                panelNumber={panel.number}
                title={panel.title}
                cwd={panel.cwd}
                gitBranch={panel.gitBranch}
                focused={panel.id === focusedId}
                fontFamily={termFont?.family}
                fontSize={termFont?.size}
                onFocus={() => { setFocusedId(panel.id); window.terminal.setFocused(panel.sessionId); }}
                onRename={(title) => handleRename(panel.id, title)}
                canClose={panels.length > 1}
                onClose={() => handleClose(panel.id)}
                fitTrigger={panel.id === focusedId ? termFitKey : undefined}
              />
            </div>
          ))}
        </div>

        {!zenMode && activePanel === "stats" && <StatsDrawer onClose={() => setActivePanel(null)} onOpenSession={handleOpenSessionTerminal} />}
        {!zenMode && activePanel === "history" && (
          <HistoryDrawer openNumbers={panels.map((p) => p.number)} onReopen={handleReopen} onClose={() => setActivePanel(null)} />
        )}
        {!zenMode && activePanel === "notes" && <NotesDrawer onClose={() => setActivePanel(null)} />}
        {!zenMode && activePanel === "claude-agents" && <ClaudeAgentsDrawer onClose={() => setActivePanel(null)} onOpenTerminal={handleOpenSessionTerminal} />}
        {splitMode && !zenMode && activePanel === "kb-chat" && (
          <div
            onMouseDown={handleSplitDragStart}
            style={{ width: 4, flexShrink: 0, cursor: "col-resize", background: "transparent", transition: "background 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = `${t.purple}40`)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          />
        )}
        {!zenMode && activePanel === "kb-chat" && (
          <KBChatErrorBoundary>
            <KBChatDrawer
              onClose={() => { setActivePanel(null); setSplitMode(false); }}
              splitMode={splitMode}
              onToggleSplit={() => setSplitMode((v) => !v)}
            />
          </KBChatErrorBoundary>
        )}

        {!zenMode && (selectedPR || selectedRepoTree) && (
          <DiffDrawer
            repoName={selectedPR?.repoName ?? selectedRepoTree!}
            prNumber={selectedPR?.prNumber}
            prTitle={selectedPR?.prTitle}
            prUrl={selectedPR?.prUrl}
            headRefName={selectedPR?.branch}
            onClose={() => { setSelectedPR(null); setSelectedRepoTree(null); }}
          />
        )}

        {/* Vertical icon rail */}
        {!zenMode && (
          <div style={{
            width: 48, flexShrink: 0,
            background: t.surface1,
            borderLeft: `1px solid ${t.border}`,
            display: "flex", flexDirection: "column",
            alignItems: "center", padding: "8px 0", gap: 2,
          }}>
            {([
              { id: "stats",         icon: "≡",  shortLabel: "Stats",  color: t.orange, label: "Stats  ⌘⇧1" },
              { id: "history",       icon: "⏱",  shortLabel: "Log",    color: t.teal,   label: "History  ⌘⇧2" },
              { id: "notes",         icon: "✏",  shortLabel: "Notes",  color: t.purple, label: "Notes  ⌘⇧3" },
              { id: "claude-agents", icon: "⬡",  shortLabel: "Claude", color: t.green,  label: "Claude  ⌘⇧4" },
              { id: "kb-chat",       icon: "◈",  shortLabel: "KB",     color: t.purple, label: "KB Chat  ⌘⇧5" },
            ] as { id: SidePanel; icon: string; shortLabel: string; color: string; label: string }[]).map(({ id, icon, shortLabel, color, label }) => {
              const active = activePanel === id;
              return (
                <button
                  key={id}
                  onClick={() => handlePanelToggle(id)}
                  title={label}
                  style={{
                    width: 36, height: 44,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: 1,
                    background: active ? `${color}18` : "none",
                    border: `1px solid ${active ? color + "40" : "transparent"}`,
                    borderRadius: 8,
                    color: active ? color : t.label3,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"; e.currentTarget.style.color = t.label2; } }}
                  onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.label3; } }}
                >
                  <span style={{ fontSize: 15, lineHeight: 1 }}>{icon}</span>
                  <span style={{ fontSize: 7, letterSpacing: 0.2, fontWeight: active ? 700 : 400, ...SYS_FONT }}>{shortLabel}</span>
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setZenMode((v) => !v)}
              title="Zen mode (⌘\)"
              style={{
                width: 36, height: 36,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "none", border: "1px solid transparent",
                borderRadius: 8, color: t.label4, cursor: "pointer", fontSize: 13,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"; e.currentTarget.style.color = t.label2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.label4; }}
            >⊡</button>
            <button
              onClick={toggleTheme}
              title={{ dark: "Switch to Slack theme", slack: "Switch to light mode", light: "Switch to dark mode" }[t.name]}
              style={{
                width: 36, height: 36,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "none", border: "1px solid transparent",
                borderRadius: 8, color: t.label4, cursor: "pointer", fontSize: 14,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"; e.currentTarget.style.color = t.label1; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.label4; }}
            >{{ dark: "☀", slack: "◐", light: "☾" }[t.name]}</button>
          </div>
        )}
      </div>
    </div>
  );
}
