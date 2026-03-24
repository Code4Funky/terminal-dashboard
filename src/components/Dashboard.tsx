import { useState, useEffect, useRef } from "react";
import { TerminalPanel } from "./TerminalPanel";
import { HistoryDrawer } from "./HistoryDrawer";
import { ClaudeSessionsDrawer } from "./ClaudeSessionsDrawer";
import { StatsDrawer } from "./StatsDrawer";

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
  const [termFont, setTermFont] = useState<{ family: string; size: number; files: string[] } | null>(null);
  const initialized = useRef(false);

  // ── Load iTerm2 font, then restore panels ────────────────────────────────
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
          restored.push({
            id: sessionId,
            sessionId,
            number: saved.number,
            title: saved.title,
          });
        }
        setPanels(restored);
        const last = restored.at(-1);
        if (last) { setFocusedId(last.id); window.terminal.setFocused(last.sessionId); }
      } else {
        const { sessionId, number } = await window.terminal.create(220, 50);
        const panel: PanelState = {
          id: sessionId,
          sessionId,
          number,
          title: `terminal ${number}`,
        };
        setPanels([panel]);
        setFocusedId(panel.id);
        window.terminal.setFocused(panel.sessionId);
        savePanels([panel]);
      }
    });
  }

  // ── Save panels on unload ────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => savePanels(panels);
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [panels]);

  // ── Listen for CWD updates from shell ────────────────────────────────────
  useEffect(() => {
    const cleanup = window.terminal.onCwdUpdate((sessionId, cwd, gitBranch) => {
      setPanels((prev) =>
        prev.map((p) => (p.sessionId === sessionId ? { ...p, cwd, gitBranch: gitBranch || undefined } : p))
      );
    });
    return cleanup;
  }, []);

  // ── Listen for panels spawned from shell (nt / new_terminal) ─────────────
  useEffect(() => {
    const cleanup = window.terminal.onNewPanel((sessionId, number) => {
      const panel: PanelState = {
        id: sessionId,
        sessionId,
        number,
        title: `terminal ${number}`,
      };
      setPanels((prev) => {
        const next = [...prev, panel];
        savePanels(next);
        return next;
      });
      setFocusedId(sessionId);
    });
    return cleanup;
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleAddPanel = async () => {
    const { sessionId, number } = await window.terminal.create(220, 50);
    const panel: PanelState = {
      id: sessionId,
      sessionId,
      number,
      title: `terminal ${number}`,
    };
    setPanels((prev) => {
      const next = [...prev, panel];
      savePanels(next);
      return next;
    });
    setFocusedId(sessionId);
  };

  const handleReopen = async (num: number) => {
    setShowHistory(false);
    const { sessionId } = await window.terminal.create(220, 50, num);
    const panel: PanelState = {
      id: sessionId,
      sessionId,
      number: num,
      title: `terminal ${num}`,
    };
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px 6px 80px",
          background: "#161b22",
          borderBottom: "1px solid #30363d",
          flexShrink: 0,
          WebkitAppRegion: "drag" as const,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", marginRight: 8, letterSpacing: 0.3 }}>
          Terminal Dashboard
        </span>

        <div style={{ display: "flex", gap: 4, marginRight: 8, WebkitAppRegion: "no-drag" as const }}>
          {COLUMN_OPTIONS.map(({ cols, icon, label }) => (
            <button
              key={cols}
              onClick={() => setColumns(cols)}
              title={label}
              style={{
                background: columns === cols ? "#21262d" : "none",
                border: columns === cols ? "1px solid #58a6ff" : "1px solid #30363d",
                borderRadius: 4,
                color: columns === cols ? "#58a6ff" : "#8b949e",
                cursor: "pointer",
                fontSize: 14,
                padding: "2px 8px",
              }}
            >
              {icon}
            </button>
          ))}
        </div>

        <button
          onClick={handleAddPanel}
          style={{
            background: "#238636",
            border: "1px solid #2ea043",
            borderRadius: 6,
            color: "#fff",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 12px",
            WebkitAppRegion: "no-drag" as const,
          }}
        >
          + New Terminal
        </button>

        <div style={{ flex: 1 }} />

        <button
          onClick={() => { setShowStats((v) => !v); setShowHistory(false); setShowClaudeSessions(false); }}
          style={{
            background: showStats ? "#3fb95026" : "none",
            border: showStats ? "1px solid #3fb950" : "1px solid #30363d",
            borderRadius: 6,
            color: showStats ? "#3fb950" : "#8b949e",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 12px",
            WebkitAppRegion: "no-drag" as const,
          }}
        >
          Stats
        </button>

        <button
          onClick={() => { setShowClaudeSessions((v) => !v); setShowHistory(false); setShowStats(false); }}
          style={{
            background: showClaudeSessions ? "#388bfd26" : "none",
            border: showClaudeSessions ? "1px solid #58a6ff" : "1px solid #30363d",
            borderRadius: 6,
            color: showClaudeSessions ? "#58a6ff" : "#8b949e",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 12px",
            WebkitAppRegion: "no-drag" as const,
          }}
        >
          Claude Sessions
        </button>

        <button
          onClick={() => { setShowHistory((v) => !v); setShowClaudeSessions(false); setShowStats(false); }}
          style={{
            background: showHistory ? "#388bfd26" : "none",
            border: showHistory ? "1px solid #58a6ff" : "1px solid #30363d",
            borderRadius: 6,
            color: showHistory ? "#58a6ff" : "#8b949e",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 12px",
            WebkitAppRegion: "no-drag" as const,
          }}
        >
          History
        </button>

        <span style={{ fontSize: 11, color: "#484f58", marginLeft: 8 }}>
          {panels.length} session{panels.length !== 1 ? "s" : ""}
        </span>
      </div>

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
    </div>
  );
}
