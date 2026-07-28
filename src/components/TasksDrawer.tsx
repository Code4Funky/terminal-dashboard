import { useEffect, useRef, useState } from "react";
import { useTheme } from "../ThemeContext";
import { SYS_FONT, MONO_FONT } from "../theme";
import type { Theme } from "../theme";
import type { TaskSummary, TaskItem, TaskStatus } from "../types/tasks";
import { RADIUS, drawerHeader, drawerTitle } from "../chrome";

type Filter = "all" | "active" | "done";
type IconKind = "manual" | "file" | "linear" | "terminal";

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number; // 0=none 1=urgent 2=high 3=medium 4=low
  state: { name: string; type: string; color: string };
  team: { name: string };
  url: string;
  updatedAt: string;
}
interface LinearState { issues: LinearIssue[]; lastSyncedAt: number | null; error: string | null }

// Green-teal accent (mockup #1D9E75) — lifted in dark for contrast. Ring, todo.md source, done checks.
const accent = (t: Theme) => (t.isDark ? "#35C79A" : "#1D9E75");

// ─── Linear status buckets ────────────────────────────────────────────────────
const LINEAR_BUCKETS = [
  { key: "review" as const, label: "In review" },
  { key: "in_progress" as const, label: "In progress" },
  { key: "qa" as const, label: "QA" },
  { key: "backlog" as const, label: "Backlog" },
];
type BucketKey = (typeof LINEAR_BUCKETS)[number]["key"];
const BACKLOG_PREVIEW = 3;

// review/QA are named states of type "started", so match by name first, then fall back to type.
function linearBucket(state: { name: string; type: string }): BucketKey {
  if (/review/i.test(state.name)) return "review";
  if (/\bqa\b|test/i.test(state.name)) return "qa";
  if (state.type === "started") return "in_progress";
  return "backlog"; // backlog / unstarted / triage
}

// Fixed semantic ramp (handoff hexes) — light: 800-on-50; dark: light text on translucent fill.
function statusStyle(key: BucketKey, t: Theme): { bg: string; text: string; dot: string } {
  const d = t.isDark;
  if (key === "review") return d ? { bg: "rgba(55,138,221,0.18)", text: "#7FB4EC", dot: "#378ADD" } : { bg: "#E6F1FB", text: "#0C447C", dot: "#378ADD" };
  if (key === "in_progress") return d ? { bg: "rgba(239,159,39,0.18)", text: "#E0A94A", dot: "#EF9F27" } : { bg: "#FAEEDA", text: "#854F0B", dot: "#EF9F27" };
  if (key === "qa") return d ? { bg: "rgba(127,119,221,0.20)", text: "#A9A3E8", dot: "#7F77DD" } : { bg: "#EEEDFE", text: "#3C3489", dot: "#7F77DD" };
  return d ? { bg: t.surface3, text: t.label3, dot: "#888780" } : { bg: t.surface1, text: t.label3, dot: "#888780" };
}

// Linear 0-4 priority → flag; none (0) shows no flag. Urgent (1) + High (2) both red, split by label.
function linearPriority(priority: number, t: Theme): { color: string; label: string } | null {
  if (priority === 1) return { color: t.red, label: "Urgent" };
  if (priority === 2) return { color: t.red, label: "High" };
  if (priority === 3) return { color: t.blue, label: "Medium" };
  if (priority === 4) return { color: t.label4, label: "Low" };
  return null;
}

const isLinearDone = (i: LinearIssue) => i.state.type === "completed" || i.state.type === "cancelled";

function formatSyncTime(ts: number | null): string {
  if (!ts) return "never";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? "1h ago" : `${hrs}h ago`;
}

interface Props {
  onClose: () => void;
}

function basename(p: string): string {
  return p.replace(/\/+$/, "").split("/").pop() || p;
}

// File cards sit under a repo header, so label them by their path within the repo (e.g.
// .claude/local/tasks/todo.md); session cards show the session's cwd basename.
function cardLabel(summary: TaskSummary): string {
  if (summary.source === "todo-file" && summary.cwd) {
    const root = summary.repoRoot;
    if (root && summary.cwd.startsWith(root + "/")) return summary.cwd.slice(root.length + 1);
    return summary.cwd.replace(/\/+$/, "").split("/").slice(-2).join("/");
  }
  return summary.cwd ? basename(summary.cwd) : summary.claudeSessionId.slice(0, 8);
}

// Row is visible when it passes both the status filter and the (optional) text query.
function taskMatches(filter: Filter, query: string, status: TaskStatus, subject: string): boolean {
  if (filter === "active" && status === "completed") return false;
  if (filter === "done" && status !== "completed") return false;
  const q = query.trim().toLowerCase();
  return !q || subject.toLowerCase().includes(q);
}

const clamp = (lines: number): React.CSSProperties =>
  ({ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines, overflow: "hidden" } as React.CSSProperties);

// Render markdown inline spans: `code` → mono pills, **bold** → emphasis. Keeps rows scannable.
function renderInline(text: string, t: Theme): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  text.split("`").forEach((seg, i) => {
    if (i % 2 === 1) {
      out.push(
        <code key={`c${i}`} style={{ fontFamily: MONO_FONT.fontFamily, fontSize: "0.9em", color: t.label1, background: t.surface3, border: `1px solid ${t.borderSubtle}`, borderRadius: RADIUS, padding: "0 4px", whiteSpace: "nowrap" }}>
          {seg}
        </code>,
      );
      return;
    }
    seg.split("**").forEach((bp, j) => {
      if (!bp) return;
      if (j % 2 === 1) out.push(<strong key={`b${i}-${j}`} style={{ fontWeight: 600, color: t.label1 }}>{bp}</strong>);
      else out.push(<span key={`s${i}-${j}`}>{bp}</span>);
    });
  });
  return out;
}

function SourceIcon({ kind, color }: { kind: IconKind; color: string }) {
  const p = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, style: { flexShrink: 0 } };
  if (kind === "file") return (<svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>);
  if (kind === "manual") return (<svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>);
  if (kind === "linear") return (<svg {...p}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8 14l6-6M11 16l5-5" /></svg>);
  return (<svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></svg>); // terminal
}

type StatusIconKind = "open" | "progress" | "done" | "alert";
function StatusIcon({ kind, color }: { kind: StatusIconKind; color: string }) {
  const p = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, style: { flexShrink: 0, marginTop: 1 } };
  if (kind === "done") return (<svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>);
  if (kind === "progress") return (<svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
  if (kind === "alert") return (<svg {...p}><path d="M12 3.5l9 16H3z" /><path d="M12 10v4" /><path d="M12 16.8v.2" /></svg>);
  return (<svg {...p}><circle cx="12" cy="12" r="9" /></svg>); // open
}

function FlagIcon({ color }: { color: string }) {
  return (<svg width={12} height={12} viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth={1.6} strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, marginTop: 2 }}><path d="M5 21V4h12l-2.2 4L17 12H5" /></svg>);
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (<span style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 600, letterSpacing: 0.2, color, background: `${color}1e`, border: `1px solid ${color}40`, borderRadius: RADIUS, padding: "1px 5px", whiteSpace: "nowrap", ...SYS_FONT }}>{children}</span>);
}

function Ring({ pct, t, size = 40 }: { pct: number; t: Theme; size?: number }) {
  const stroke = 3;
  const r = 15.5; // handoff geometry: r=15.5 → circ≈97.4 inside a 40px box
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)"} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={accent(t)} strokeWidth={stroke} strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.35s ease" }} />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, color: t.label1, ...SYS_FONT }}>{pct}%</span>
    </div>
  );
}

// Mutually-exclusive filter as a joined segmented control.
function SegmentedFilter({ filter, counts, onChange, t }: { filter: Filter; counts: Record<Filter, number>; onChange: (f: Filter) => void; t: Theme }) {
  const opts: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "done", label: "Done" },
  ];
  return (
    <div role="group" aria-label="Filter tasks" style={{ display: "inline-flex", border: `1px solid ${t.borderMid}`, borderRadius: RADIUS, overflow: "hidden", background: t.surface2 }}>
      {opts.map((o, i) => {
        const active = filter === o.key;
        return (
          <button
            key={o.key}
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            style={{ fontSize: 11, fontWeight: 600, ...SYS_FONT, cursor: "pointer", padding: "3px 11px", border: "none", borderLeft: i > 0 ? `1px solid ${t.borderSubtle}` : "none", background: active ? accent(t) : "transparent", color: active ? "#fff" : t.label3, transition: "all 0.12s", whiteSpace: "nowrap" }}
          >
            {o.label} <span style={{ opacity: 0.75 }}>{counts[o.key]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TasksDrawer({ onClose }: Props) {
  const { theme: t } = useTheme();
  const [sessions, setSessions] = useState<Record<string, TaskSummary>>({});
  const [taskInstalled, setTaskInstalled] = useState<boolean | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [linear, setLinear] = useState<LinearState>({ issues: [], lastSyncedAt: null, error: null });
  const [syncing, setSyncing] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [clearTarget, setClearTarget] = useState<{ cwd: string; label: string; count: number } | null>(null);

  useEffect(() => {
    window.terminal.getAllClaudeTasks().then((list) => {
      setSessions(Object.fromEntries(list.map((s) => [s.claudeSessionId, s])));
    });
    window.terminal.getClaudeHookStatus().then((st) => setTaskInstalled(st.taskInstalled));
    window.terminal.getLinearIssues().then(setLinear);
    return window.terminal.onLinearIssuesUpdated(setLinear);
  }, []);

  useEffect(() => {
    return window.terminal.onClaudeTasksUpdated((sum) => {
      setSessions((prev) => ({ ...prev, [sum.claudeSessionId]: sum }));
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Peel the innermost layer first: confirm modal → search → drawer.
      if (clearTarget) setClearTarget(null);
      else if (showSearch) { setShowSearch(false); setQuery(""); }
      else onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, clearTarget, showSearch]);

  const requestClearCompleted = (cwd: string, label: string, count: number) => setClearTarget({ cwd, label, count });

  const confirmClearCompleted = async () => {
    if (!clearTarget) return;
    const { cwd } = clearTarget;
    setClearTarget(null);
    await window.terminal.clearCompletedTodoFileItems(cwd).catch(() => {}); // list refreshes via onClaudeTasksUpdated
  };

  const handleEnable = async () => {
    const result = await window.terminal.installTaskHook();
    if (result.ok) window.terminal.getClaudeHookStatus().then((st) => setTaskInstalled(st.taskInstalled));
    else alert(`Failed to enable task capture: ${result.error ?? "unknown error"}`);
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try { await window.terminal.syncLinear(); } finally { setSyncing(false); }
  };

  const handleRescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    // Discovered files stream in via onClaudeTasksUpdated; just clear the spinner when done.
    try { await window.terminal.rescanTodoFiles(); } finally { setRescanning(false); }
  };

  const toggle = (key: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  // Three axes: manual (its own section), todo.md files (grouped by repo), Claude sessions (by terminal).
  const all = Object.values(sessions);
  const manual = all.find((s) => s.source === "manual");
  const fileGroups = all.filter((s) => s.total > 0 && s.source === "todo-file");
  const sessionGroups = all.filter((s) => s.total > 0 && (s.source === "task-tools" || s.source === "todowrite"));

  // Header ring + chip counts aggregate every source, Linear included (issue count = total; done/cancelled = done).
  const withTasks = all.filter((s) => s.total > 0);
  const linearTotal = linear.issues.length;
  const linearDone = linear.issues.filter(isLinearDone).length;
  const totalCount = withTasks.reduce((n, s) => n + s.total, 0) + linearTotal;
  const doneCount = withTasks.reduce((n, s) => n + s.completed, 0) + linearDone;
  const activeCount = totalCount - doneCount;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const sourceCount = [(manual?.total ?? 0) > 0, fileGroups.length > 0, sessionGroups.length > 0, linearTotal > 0].filter(Boolean).length;

  const byRepo = new Map<string, TaskSummary[]>();
  for (const s of fileGroups) {
    const key = s.repoRoot || s.cwd;
    const arr = byRepo.get(key);
    if (arr) arr.push(s);
    else byRepo.set(key, [s]);
  }
  const repoKeys = [...byRepo.keys()].sort();
  for (const k of repoKeys) byRepo.get(k)!.sort((a, b) => a.cwd.localeCompare(b.cwd));

  const byPanel = new Map<number | null, TaskSummary[]>();
  for (const s of sessionGroups) {
    const arr = byPanel.get(s.panelNumber);
    if (arr) arr.push(s);
    else byPanel.set(s.panelNumber, [s]);
  }
  const panelKeys = [...byPanel.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });
  for (const k of panelKeys) byPanel.get(k)!.sort((a, b) => b.updatedAt - a.updatedAt);

  const groupVisible = (sums: TaskSummary[]) => sums.some((s) => s.tasks.some((tk) => taskMatches(filter, query, tk.status, tk.subject)));
  const visibleRepoKeys = repoKeys.filter((k) => groupVisible(byRepo.get(k)!));
  const visiblePanelKeys = panelKeys.filter((k) => groupVisible(byPanel.get(k)!));
  const nothingCaptured = fileGroups.length === 0 && sessionGroups.length === 0;
  const nothingMatches = !nothingCaptured && visibleRepoKeys.length === 0 && visiblePanelKeys.length === 0;

  return (
    <div
      style={{
        width: 440,
        flexShrink: 0,
        margin: 8,
        borderRadius: RADIUS,
        overflow: "hidden",
        background: t.surface1,
        backdropFilter: t.backdropFilter,
        WebkitBackdropFilter: t.backdropFilter,
        border: `1px solid ${t.border}`,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        boxShadow: t.isDark ? "-4px 0 28px rgba(0,0,0,0.6)" : "-4px 0 16px rgba(0,0,0,0.08)",
      }}
    >
      <style>{`@keyframes td-spin { to { transform: rotate(360deg); } }`}</style>
      {/* Header — completion ring + progress summary */}
      <div style={{ ...drawerHeader(t), gap: 12, padding: "6px 10px 6px 14px" }}>
        <Ring pct={pct} t={t} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={drawerTitle(t)}>Tasks</div>
          <div style={{ fontSize: 11, color: t.label3, ...SYS_FONT }}>
            {totalCount > 0 ? `${doneCount} of ${totalCount} done · ${activeCount} open across ${sourceCount} source${sourceCount === 1 ? "" : "s"}` : "No tasks yet"}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ alignSelf: "flex-start", background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px", transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
        >
          ×
        </button>
      </div>

      {/* Filter chips + search */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderBottom: `1px solid ${t.borderSubtle}`, flexShrink: 0 }}>
        <SegmentedFilter filter={filter} counts={{ all: totalCount, active: activeCount, done: doneCount }} onChange={setFilter} t={t} />
        <div style={{ flex: 1 }} />
        <button
          onClick={handleRescan}
          disabled={rescanning}
          aria-label="Rescan todo.md files"
          title="Rescan todo.md files"
          style={{ background: "none", border: "none", cursor: rescanning ? "default" : "pointer", color: rescanning ? t.blue : t.label3, padding: 2, lineHeight: 0, transition: "color 0.15s" }}
          onMouseEnter={(e) => { if (!rescanning) e.currentTarget.style.color = t.label1; }}
          onMouseLeave={(e) => { if (!rescanning) e.currentTarget.style.color = t.label3; }}
        >
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={rescanning ? { animation: "td-spin 0.8s linear infinite" } : undefined}><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
        </button>
        <button
          onClick={() => { setShowSearch((p) => !p); if (showSearch) setQuery(""); }}
          aria-label="Search tasks"
          aria-pressed={showSearch}
          title="Search tasks"
          style={{ background: "none", border: "none", cursor: "pointer", color: showSearch ? t.blue : t.label3, padding: 2, lineHeight: 0, transition: "color 0.15s" }}
        >
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        </button>
      </div>
      {showSearch && (
        <div style={{ padding: "0 16px 10px", flexShrink: 0 }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tasks…"
            style={{ width: "100%", boxSizing: "border-box", background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS, color: t.label1, fontSize: 12, padding: "5px 9px", outline: "none", ...SYS_FONT }}
          />
        </div>
      )}

      {/* Enable/update-capture banner */}
      {taskInstalled === false && (
        <div style={{ padding: "12px 16px", background: `${t.blue}12`, borderBottom: `1px solid ${t.borderSubtle}`, flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.label1, marginBottom: 4, ...SYS_FONT }}>Enable task capture</div>
          <div style={{ fontSize: 11, color: t.label3, lineHeight: 1.55, marginBottom: 10, ...SYS_FONT }}>
            Install a Claude PostToolUse hook to capture the tasks Claude builds — its task list and any <code>*todo.md</code> it writes — shown here and in each panel's title bar.
          </div>
          <button
            onClick={handleEnable}
            style={{ background: `${t.blue}22`, border: `1px solid ${t.blue}50`, borderRadius: RADIUS, color: t.blue, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "4px 12px", transition: "background 0.15s", ...SYS_FONT }}
            onMouseEnter={(e) => (e.currentTarget.style.background = `${t.blue}35`)}
            onMouseLeave={(e) => (e.currentTarget.style.background = `${t.blue}22`)}
          >
            Enable
          </button>
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <ManualSection manual={manual} filter={filter} query={query} t={t} />
        <LinearSection issues={linear.issues} lastSyncedAt={linear.lastSyncedAt} error={linear.error} syncing={syncing} onSync={handleSync} filter={filter} query={query} t={t} />
        {nothingCaptured ? (
          <div style={{ padding: "32px 16px", color: t.label4, fontSize: 12, textAlign: "center", lineHeight: 1.6, ...SYS_FONT }}>
            No Claude or todo.md tasks captured yet.
          </div>
        ) : nothingMatches ? (
          <div style={{ padding: "24px 16px", color: t.label4, fontSize: 12, textAlign: "center", ...SYS_FONT }}>
            No matching tasks.
          </div>
        ) : (
          <>
            {/* todo.md files, grouped by repo */}
            {visibleRepoKeys.map((key) => {
              const sums = byRepo.get(key)!;
              const done = sums.reduce((n, s) => n + s.completed, 0);
              const total = sums.reduce((n, s) => n + s.total, 0);
              const cKey = `repo:${key}`;
              return (
                <CollapsibleSection key={cKey} iconKind="file" label={basename(key)} done={done} total={total} isCollapsed={collapsed.has(cKey)} onToggle={() => toggle(cKey)} t={t}>
                  {sums.map((s) => <SessionCard key={s.claudeSessionId} summary={s} filter={filter} query={query} onClearCompleted={requestClearCompleted} t={t} />)}
                </CollapsibleSection>
              );
            })}
            {/* Claude sessions, grouped by terminal */}
            {visiblePanelKeys.map((key) => {
              const sums = byPanel.get(key)!;
              const done = sums.reduce((n, s) => n + s.completed, 0);
              const total = sums.reduce((n, s) => n + s.total, 0);
              const cKey = key === null ? "detached" : `panel:${key}`;
              return (
                <CollapsibleSection key={cKey} iconKind="terminal" label={key === null ? "Detached" : `Terminal ${key}`} done={done} total={total} isCollapsed={collapsed.has(cKey)} onToggle={() => toggle(cKey)} t={t}>
                  {sums.map((s) => <SessionCard key={s.claudeSessionId} summary={s} filter={filter} query={query} onClearCompleted={requestClearCompleted} t={t} />)}
                </CollapsibleSection>
              );
            })}
          </>
        )}
      </div>

      {/* Clear-completed confirmation */}
      {clearTarget && (
        <div style={{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: t.surface1, border: `1px solid ${t.border}`, borderRadius: RADIUS, padding: "20px 22px", width: 300, boxShadow: "0 8px 40px rgba(0,0,0,0.4)" }}>
            <div style={{ color: t.red, fontWeight: 600, fontSize: 14, marginBottom: 8, ...SYS_FONT }}>Delete completed tasks?</div>
            <div style={{ color: t.label2, fontSize: 12, marginBottom: 18, lineHeight: 1.6, ...SYS_FONT }}>
              This will permanently remove {clearTarget.count} completed task{clearTarget.count === 1 ? "" : "s"} from <span style={{ color: accent(t), fontFamily: MONO_FONT.fontFamily }}>{clearTarget.label}</span>. This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setClearTarget(null)} style={{ background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS, color: t.label2, cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 16px", ...SYS_FONT }}>Cancel</button>
              <button onClick={confirmClearCompleted} style={{ background: t.red, border: "none", borderRadius: RADIUS, color: "#FFFFFF", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 18px", ...SYS_FONT }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Group header (shared) ────────────────────────────────────────────────────

function GroupHeader({ iconKind, label, done, total, count, isCollapsed, onToggle, right, segments, t }: {
  iconKind: IconKind;
  label: string;
  done: number;
  total: number;
  count?: React.ReactNode;
  isCollapsed: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
  segments?: { color: string; value: number }[];
  t: Theme;
}) {
  const bar = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = total > 0 && done === total;
  const iconColor = iconKind === "manual" ? t.orange : iconKind === "file" ? accent(t) : iconKind === "linear" ? t.purple : t.blue;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px 8px 16px", background: t.surface2, borderTop: `1px solid ${t.borderSubtle}`, borderBottom: `1px solid ${t.borderSubtle}` }}>
      <button onClick={onToggle} aria-expanded={!isCollapsed} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
        <span aria-hidden style={{ fontSize: 9, color: t.label4, display: "inline-block", transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s" }}>▾</span>
        <SourceIcon kind={iconKind} color={iconColor} />
        <span style={{ fontSize: 12, fontWeight: 600, color: t.label1, whiteSpace: "nowrap", ...SYS_FONT }}>{label}</span>
        <span style={{ fontSize: 10, fontFamily: MONO_FONT.fontFamily, fontWeight: 600, color: allDone ? t.green : t.label4, flexShrink: 0 }}>{count ?? `${done}/${total}`}</span>
        {total > 0 && (segments ? (
          <span style={{ flex: 1, minWidth: 24, height: 5, borderRadius: 3, overflow: "hidden", display: "flex", gap: 1 }}>
            {segments.filter((s) => s.value > 0).map((s, i) => <span key={i} style={{ flex: s.value, background: s.color }} />)}
          </span>
        ) : (
          <span style={{ flex: 1, minWidth: 24, height: 5, borderRadius: 3, background: t.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${bar}%`, background: allDone ? t.green : iconColor, borderRadius: 3, transition: "width 0.25s ease" }} />
          </span>
        ))}
      </button>
      {right}
    </div>
  );
}

interface CollapsibleSectionProps {
  iconKind: IconKind;
  label: string;
  done: number;
  total: number;
  isCollapsed: boolean;
  onToggle: () => void;
  t: Theme;
  children: React.ReactNode;
}

function CollapsibleSection({ iconKind, label, done, total, isCollapsed, onToggle, t, children }: CollapsibleSectionProps) {
  return (
    <div>
      <GroupHeader iconKind={iconKind} label={label} done={done} total={total} isCollapsed={isCollapsed} onToggle={onToggle} t={t} />
      {!isCollapsed && (
        <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Task row ───────────────────────────────────────────────────────────────────

// ─── Row actions (Implement / open / more) ──────────────────────────────────────

// Type the task into the focused terminal (no newline — user reviews before running).
// Backticks stripped so a shell prompt can't command-substitute the injected text.
function fireImplement(identifier: string | null, subject: string) {
  const clean = subject.replace(/`/g, "").replace(/\s{2,}/g, " ").trim();
  window.terminal.writeToFocusedTerminal(identifier ? `Implement ${identifier}: ${clean}` : `Implement: ${clean}`);
}

function ImplementBtn({ onClick, t }: { onClick: () => void; t: Theme }) {
  const [sent, setSent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick();
    setSent(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSent(false), 1400);
  };
  return (
    <button
      onClick={click}
      title="Send to focused terminal"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, height: 24, padding: "0 9px", borderRadius: RADIUS, border: "none", cursor: "pointer", background: t.isDark ? "rgba(255,255,255,0.10)" : "#1D1D1F", color: t.isDark ? t.label1 : "#fff", fontSize: 11, fontWeight: 600, ...SYS_FONT, transition: "background 0.12s" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.16)" : "#333")}
      onMouseLeave={(e) => (e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.10)" : "#1D1D1F")}
    >
      {sent ? (
        <><svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>Sent</>
      ) : (
        <><svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>Implement</>
      )}
    </button>
  );
}

// Deletes the line from the *todo.md on disk — signalled with a trash icon, not the manual list's dismiss ×.
function DeleteBtn({ onClick, t }: { onClick: () => void; t: Theme }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="Delete from todo.md"
      aria-label="Delete task"
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, width: 24, height: 24, borderRadius: RADIUS, border: `1px solid ${t.borderMid}`, background: "transparent", color: t.label4, cursor: "pointer", padding: 0, transition: "all 0.12s" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = `${t.red}1e`; e.currentTarget.style.borderColor = `${t.red}55`; e.currentTarget.style.color = t.red; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = t.borderMid; e.currentTarget.style.color = t.label4; }}
    >
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" /></svg>
    </button>
  );
}

function IconActionBtn({ label, onClick, t, children }: { label: string; onClick: () => void; t: Theme; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={label}
      aria-label={label}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, width: 24, height: 24, borderRadius: RADIUS, border: `1px solid ${t.borderMid}`, background: "transparent", color: t.label3, cursor: "pointer", padding: 0, transition: "all 0.12s" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = t.surface3; e.currentTarget.style.color = t.label1; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.label3; }}
    >
      {children}
    </button>
  );
}

function MenuItem({ onClick, t, children }: { onClick: () => void; t: Theme; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{ textAlign: "left", background: "none", border: "none", cursor: "pointer", color: t.label2, fontSize: 11, ...SYS_FONT, padding: "6px 8px", borderRadius: RADIUS, transition: "background 0.1s" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = t.surface3)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}

// ─── Task row ───────────────────────────────────────────────────────────────────

function TaskRow({ task, source, t, onDelete }: { task: TaskItem; source: TaskSummary["source"]; t: Theme; onDelete?: () => void }) {
  const [hover, setHover] = useState(false);
  const done = task.status === "completed";
  const isFile = source === "todo-file";
  const blocked = isFile && !!task.blocked && !done;
  // Explicit (P0) priority, or the legacy "top priority" phrase, both surface a red callout.
  const topPri = isFile && !done && (task.priority === "high" || /top priority/i.test(task.subject));
  const due = isFile && !done ? task.due : undefined;
  const label = task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject;
  const iconKind: StatusIconKind = done ? "done" : blocked || topPri ? "alert" : task.status === "in_progress" || due ? "progress" : "open";
  const iconColor = done ? accent(t) : blocked || topPri ? t.red : task.status === "in_progress" || due ? t.orange : t.label4;
  const hasBadges = blocked || topPri || !!due;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11, lineHeight: 1.45, borderLeft: `2px solid ${blocked ? t.red : "transparent"}`, padding: "3px 4px 3px 6px", borderRadius: RADIUS, background: hover ? t.surface3 : "transparent", transition: "background 0.1s" }}
    >
      <StatusIcon kind={iconKind} color={iconColor} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        {hasBadges && (
          <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {blocked && <Badge color={t.red}>Blocked</Badge>}
            {topPri && !blocked && <Badge color={t.red}>Top priority</Badge>}
            {due && <Badge color={t.orange}>Due {due}</Badge>}
          </span>
        )}
        <span style={{ color: t.label2, textDecoration: done ? "line-through" : "none", ...SYS_FONT }}>{renderInline(label, t)}</span>
      </span>
      {hover && (!done || onDelete) && (
        <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {!done && <ImplementBtn onClick={() => fireImplement(null, task.subject)} t={t} />}
          {onDelete && <DeleteBtn onClick={onDelete} t={t} />}
        </span>
      )}
    </div>
  );
}

// ─── Session card ─────────────────────────────────────────────────────────────

function SessionCard({ summary, filter, query, t, onClearCompleted }: { summary: TaskSummary; filter: Filter; query: string; t: Theme; onClearCompleted: (cwd: string, label: string, count: number) => void }) {
  const [showDone, setShowDone] = useState(false);
  const q = query.trim().toLowerCase();
  const qMatch = (tk: TaskItem) => !q || tk.subject.toLowerCase().includes(q);
  const pending = summary.tasks.filter((tk) => tk.status !== "completed" && qMatch(tk));
  const done = summary.tasks.filter((tk) => tk.status === "completed" && qMatch(tk));

  // Only todo.md items are deletable — their f<i> id maps to the file's i-th task line. Live sources mirror Claude's list.
  const deleteFor = summary.source === "todo-file"
    ? (task: TaskItem) => {
        const idx = parseInt(task.id.slice(1), 10);
        if (!Number.isNaN(idx)) window.terminal.deleteTodoFileItem(summary.cwd, idx);
      }
    : undefined;

  const showPending = filter !== "done" && pending.length > 0;
  const showDoneInline = filter === "done" && done.length > 0;
  const showDoneCollapsible = filter === "all" && done.length > 0;
  if (!showPending && !showDoneInline && !showDoneCollapsible) return null;

  return (
    <div style={{ background: t.surface2, border: `1px solid ${t.borderSubtle}`, borderRadius: RADIUS, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: t.label3, fontFamily: MONO_FONT.fontFamily, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {cardLabel(summary)}
        </span>
        {summary.source === "todo-file" && summary.completed > 0 && (
          <button
            onClick={() => onClearCompleted(summary.cwd, cardLabel(summary), summary.completed)}
            title="Delete all completed tasks from this todo.md"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, height: 20, padding: "0 7px", borderRadius: RADIUS, border: `1px solid ${t.borderMid}`, background: "transparent", color: t.label4, cursor: "pointer", fontSize: 10, fontWeight: 600, ...SYS_FONT, transition: "all 0.12s" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `${t.red}1e`; e.currentTarget.style.borderColor = `${t.red}55`; e.currentTarget.style.color = t.red; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = t.borderMid; e.currentTarget.style.color = t.label4; }}
          >
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
            Clear done
          </button>
        )}
        <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, color: summary.completed === summary.total ? t.green : t.label4, fontFamily: MONO_FONT.fontFamily }}>
          {summary.completed}/{summary.total}
        </span>
      </div>

      {showPending && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {pending.map((task) => <TaskRow key={task.id} task={task} source={summary.source} t={t} onDelete={deleteFor ? () => deleteFor(task) : undefined} />)}
        </div>
      )}

      {showDoneInline && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, opacity: 0.5 }}>
          {done.map((task) => <TaskRow key={task.id} task={task} source={summary.source} t={t} onDelete={deleteFor ? () => deleteFor(task) : undefined} />)}
        </div>
      )}

      {showDoneCollapsible && (
        <div>
          <button onClick={() => setShowDone((p) => !p)} aria-expanded={showDone} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, padding: 0 }}>
            <span aria-hidden style={{ fontSize: 9, color: t.label4, display: "inline-block", transform: showDone ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}>▾</span>
            <span style={{ fontSize: 10, color: t.label4, ...SYS_FONT }}>{done.length} completed</span>
          </button>
          {showDone && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, opacity: 0.5 }}>
              {done.map((task) => <TaskRow key={task.id} task={task} source={summary.source} t={t} onDelete={deleteFor ? () => deleteFor(task) : undefined} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Manual section ───────────────────────────────────────────────────────────

function ManualSection({ manual, filter, query, t }: { manual: TaskSummary | undefined; filter: Filter; query: string; t: Theme }) {
  const [text, setText] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const tasks = manual?.tasks ?? [];
  const doneTotal = tasks.filter((tk) => tk.status === "completed").length;

  const q = query.trim().toLowerCase();
  const qMatch = (tk: TaskItem) => !q || tk.subject.toLowerCase().includes(q);
  const pendingTasks = tasks.filter((tk) => tk.status !== "completed" && qMatch(tk));
  const doneTasks = tasks.filter((tk) => tk.status === "completed" && qMatch(tk));
  const showPending = filter !== "done";
  const showDoneInline = filter === "done";
  const showDoneCollapsible = filter === "all";

  const add = async () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    await window.terminal.addManualTask(v); // live-patched via onClaudeTasksUpdated
  };

  return (
    <div>
      <GroupHeader iconKind="manual" label="Manual" done={doneTotal} total={tasks.length} count={tasks.length > 0 ? undefined : ""} isCollapsed={isCollapsed} onToggle={() => setIsCollapsed((p) => !p)} t={t} />

      {!isCollapsed && (
        <div style={{ padding: "10px 10px 12px", borderBottom: `1px solid ${t.borderSubtle}` }}>
          <div style={{ display: "flex", gap: 6, marginBottom: pendingTasks.length > 0 || doneTasks.length > 0 ? 8 : 0 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              placeholder="Add a task…"
              style={{ flex: 1, minWidth: 0, background: t.surface2, border: `1px solid ${t.border}`, borderRadius: RADIUS, color: t.label1, fontSize: 12, padding: "5px 9px", outline: "none", ...SYS_FONT }}
            />
            <button
              onClick={add}
              aria-label="Add task"
              title="Add task"
              style={{ flexShrink: 0, width: 30, background: `${t.blue}22`, border: `1px solid ${t.blue}50`, borderRadius: RADIUS, color: t.blue, cursor: "pointer", fontSize: 16, fontWeight: 600, lineHeight: 1, padding: 0, transition: "background 0.15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = `${t.blue}35`)}
              onMouseLeave={(e) => (e.currentTarget.style.background = `${t.blue}22`)}
            >
              +
            </button>
          </div>
          {showPending && pendingTasks.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {pendingTasks.map((task) => <ManualRow key={task.id} task={task} t={t} />)}
            </div>
          )}
          {showDoneInline && doneTasks.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, opacity: 0.5 }}>
              {doneTasks.map((task) => <ManualRow key={task.id} task={task} t={t} />)}
            </div>
          )}
          {showDoneCollapsible && doneTasks.length > 0 && (
            <div style={{ marginTop: pendingTasks.length > 0 ? 6 : 0 }}>
              <button onClick={() => setShowDone((p) => !p)} aria-expanded={showDone} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, padding: "2px 4px" }}>
                <span aria-hidden style={{ fontSize: 9, color: t.label4, display: "inline-block", transform: showDone ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}>▾</span>
                <span style={{ fontSize: 10, color: t.label4, ...SYS_FONT }}>{doneTasks.length} completed</span>
              </button>
              {showDone && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4, opacity: 0.5 }}>
                  {doneTasks.map((task) => <ManualRow key={task.id} task={task} t={t} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ManualRow({ task, t }: { task: TaskItem; t: Theme }) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const done = task.status === "completed";
  const toggle = () => window.terminal.toggleManualTask(task.id);
  const remove = () => window.terminal.removeManualTask(task.id);
  const onKey = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } };
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false); }}
      style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11, lineHeight: 1.45, padding: "3px 4px", borderRadius: RADIUS, background: hover || focused ? t.surface3 : "transparent", transition: "background 0.1s", opacity: done ? 0.5 : 1 }}
    >
      <span
        onClick={toggle}
        onKeyDown={onKey(toggle)}
        tabIndex={0}
        aria-label={done ? "Mark task incomplete" : "Mark task complete"}
        role="button"
        style={{ cursor: "pointer", color: done ? t.green : t.label4, flexShrink: 0, fontSize: 12, marginTop: 1, userSelect: "none" }}
      >
        {done ? "✓" : "○"}
      </span>
      <span
        onClick={toggle}
        title={task.subject}
        style={{ flex: 1, minWidth: 0, cursor: "pointer", color: t.label2, textDecoration: done ? "line-through" : "none", userSelect: "none", ...clamp(2), ...SYS_FONT }}
      >
        {renderInline(task.subject, t)}
      </span>
      {(hover || focused) && (
        <span
          onClick={remove}
          onKeyDown={onKey(remove)}
          tabIndex={0}
          aria-label="Remove task"
          role="button"
          title="Remove"
          style={{ cursor: "pointer", color: t.label4, flexShrink: 0, fontSize: 14, lineHeight: 1, userSelect: "none", transition: "color 0.1s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.red)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
        >
          ×
        </span>
      )}
    </div>
  );
}

// ─── Linear section ───────────────────────────────────────────────────────────

function LinearSection({ issues, lastSyncedAt, error, syncing, onSync, filter, query, t }: {
  issues: LinearIssue[];
  lastSyncedAt: number | null;
  error: string | null;
  syncing: boolean;
  onSync: () => void;
  filter: Filter;
  query: string;
  t: Theme;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showAllBacklog, setShowAllBacklog] = useState(false);
  const [syncTime, setSyncTime] = useState("");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = () => setSyncTime(formatSyncTime(lastSyncedAt));
    tick();
    tickRef.current = setInterval(tick, 60000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [lastSyncedAt]);

  const q = query.trim().toLowerCase();
  const qMatch = (i: LinearIssue) => !q || i.title.toLowerCase().includes(q) || i.identifier.toLowerCase().includes(q);
  const priRank = (p: number) => (p === 0 ? 99 : p); // urgent(1) first, none(0) last
  const active = issues.filter((i) => !isLinearDone(i) && qMatch(i));
  const done = issues.filter((i) => isLinearDone(i) && qMatch(i)).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));

  const buckets = LINEAR_BUCKETS.map((b) => ({
    ...b,
    st: statusStyle(b.key, t),
    issues: active.filter((i) => linearBucket(i.state) === b.key).sort((x, y) => priRank(x.priority) - priRank(y.priority)),
  })).filter((b) => b.issues.length > 0);
  const segments = buckets.map((b) => ({ color: b.st.dot, value: b.issues.length }));

  const showActive = filter !== "done";
  const showDoneInline = filter === "done";
  const showDoneCollapsible = filter === "all";

  const syncButton = (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      {lastSyncedAt && <span style={{ fontSize: 9, color: t.label4, ...SYS_FONT }}>{syncTime}</span>}
      <button
        onClick={onSync}
        aria-label="Sync Linear issues"
        title="Sync via claude"
        disabled={syncing}
        style={{ background: "none", border: "none", cursor: syncing ? "default" : "pointer", color: t.label4, fontSize: 13, lineHeight: 1, padding: 0, opacity: syncing ? 0.6 : 1 }}
        onMouseEnter={(e) => { if (!syncing) e.currentTarget.style.color = t.label2; }}
        onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
      >
        <span style={{ display: "inline-block", animation: syncing ? "td-spin 0.9s linear infinite" : undefined }}>↻</span>
      </button>
    </div>
  );

  return (
    <div>
      <GroupHeader iconKind="linear" label="Linear" done={done.length} total={issues.length} count={String(active.length)} segments={segments} isCollapsed={isCollapsed} onToggle={() => setIsCollapsed((p) => !p)} right={syncButton} t={t} />

      {!isCollapsed && (
        <div style={{ borderBottom: `1px solid ${t.borderSubtle}` }}>
          {error && (
            <div style={{ padding: "6px 12px", background: `${t.red}12`, borderBottom: `1px solid ${t.borderSubtle}` }}>
              <span style={{ fontSize: 10, color: t.red, ...SYS_FONT }}>Sync error: {error}</span>
            </div>
          )}
          {active.length === 0 && !syncing && !error && showActive && (
            <div style={{ padding: "16px 12px", color: t.label4, fontSize: 11, textAlign: "center", lineHeight: 1.6, ...SYS_FONT }}>
              {lastSyncedAt ? (q ? "No matching issues." : "No open issues assigned to you.") : "Hit ↻ to sync your Linear issues via claude."}
            </div>
          )}
          {showActive && buckets.map((b) => {
            const isBacklog = b.key === "backlog";
            const shown = isBacklog && !showAllBacklog ? b.issues.slice(0, BACKLOG_PREVIEW) : b.issues;
            const hidden = b.issues.length - shown.length;
            return (
              <div key={b.key}>
                <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", background: t.surface2, borderBottom: `1px solid ${t.borderSubtle}` }}>
                  <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: b.st.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", color: t.label3, ...SYS_FONT }}>{b.label}</span>
                  <span style={{ fontSize: 9, fontWeight: 600, color: t.label4, fontFamily: MONO_FONT.fontFamily }}>{hidden > 0 ? `${shown.length} (${b.issues.length})` : String(b.issues.length)}</span>
                </div>
                <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                  {shown.map((issue) => <LinearIssueRow key={issue.id} issue={issue} t={t} />)}
                  {isBacklog && hidden > 0 && (
                    <button onClick={() => setShowAllBacklog(true)} style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 10, fontWeight: 600, padding: "2px 4px", ...SYS_FONT }}>
                      Show {hidden} more backlog
                    </button>
                  )}
                  {isBacklog && showAllBacklog && b.issues.length > BACKLOG_PREVIEW && (
                    <button onClick={() => setShowAllBacklog(false)} style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 10, fontWeight: 600, padding: "2px 4px", ...SYS_FONT }}>
                      Show less
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {showDoneInline && done.length > 0 && (
            <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4, opacity: 0.5 }}>
              {done.map((issue) => <LinearIssueRow key={issue.id} issue={issue} t={t} />)}
            </div>
          )}
          {showDoneCollapsible && done.length > 0 && (
            <div style={{ padding: "0 10px 8px" }}>
              <button onClick={() => setShowDone((p) => !p)} aria-expanded={showDone} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, padding: "2px 4px" }}>
                <span aria-hidden style={{ fontSize: 9, color: t.label4, display: "inline-block", transform: showDone ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}>▾</span>
                <span style={{ fontSize: 10, color: t.label4, ...SYS_FONT }}>{done.length} completed</span>
              </button>
              {showDone && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4, opacity: 0.5 }}>
                  {done.map((issue) => <LinearIssueRow key={issue.id} issue={issue} t={t} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LinearIssueRow({ issue, t }: { issue: LinearIssue; t: Theme }) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pri = linearPriority(issue.priority, t);
  const st = statusStyle(linearBucket(issue.state), t);
  const backlog = linearBucket(issue.state) === "backlog";
  const showActions = hover || focused || menuOpen;

  // Close the menu on any click outside it, or on Escape. Escape is captured so the drawer's own
  // Escape handler is skipped — the menu closes without the whole drawer closing.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); setMenuOpen(false); } };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", onKey, true); };
  }, [menuOpen]);

  const copy = (text: string) => { navigator.clipboard?.writeText(text); setMenuOpen(false); };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${issue.identifier}: ${issue.title}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false); }}
      onClick={() => window.terminal.openExternal(issue.url)}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); window.terminal.openExternal(issue.url); } }}
      style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 7, padding: "6px 6px", borderRadius: RADIUS, background: showActions ? t.surface3 : "transparent", cursor: "pointer", transition: "background 0.1s" }}
    >
      {pri ? <FlagIcon color={pri.color} /> : <span aria-hidden style={{ width: 12, flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: t.label4, fontFamily: MONO_FONT.fontFamily }}>{issue.identifier}</span>
          {pri && <span style={{ fontSize: 9, color: pri.color, fontWeight: 600, ...SYS_FONT }}>{pri.label}</span>}
        </div>
        <span style={{ fontSize: 11, color: backlog ? t.label3 : t.label2, lineHeight: 1.4, display: "block", ...SYS_FONT }}>{renderInline(issue.title, t)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, marginTop: 2 }}>
        {showActions && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }} onClick={(e) => e.stopPropagation()}>
            <IconActionBtn label="Open in Linear" onClick={() => window.terminal.openExternal(issue.url)} t={t}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17L17 7" /><path d="M8 7h9v9" /></svg>
            </IconActionBtn>
            <div style={{ position: "relative" }}>
              <IconActionBtn label="More" onClick={() => setMenuOpen((p) => !p)} t={t}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
              </IconActionBtn>
              {menuOpen && (
                <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 28, right: 0, zIndex: 10, minWidth: 128, background: t.surface1, border: `1px solid ${t.border}`, borderRadius: RADIUS, boxShadow: t.isDark ? "0 6px 20px rgba(0,0,0,0.5)" : "0 6px 20px rgba(0,0,0,0.15)", padding: 4, display: "flex", flexDirection: "column" }}>
                  <MenuItem onClick={() => copy(issue.identifier)} t={t}>Copy ID</MenuItem>
                  <MenuItem onClick={() => copy(issue.url)} t={t}>Copy link</MenuItem>
                </div>
              )}
            </div>
          </div>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 600, color: st.text, background: st.bg, borderRadius: RADIUS, padding: "2px 6px", whiteSpace: "nowrap", ...SYS_FONT }}>
          <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: st.dot }} />
          {issue.state.name}
        </span>
      </div>
    </div>
  );
}
