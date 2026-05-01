import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../ThemeContext";
import { Theme } from "../theme";

interface RepoEntry { name: string; visits: number; lastSeen: number }

interface UsageSession {
  sessionId: string;
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  lastActivity: string;
  modelsUsed: string[];
  resolvedPath: string | null;
}

interface ClaudeLimits {
  five_hour: { utilization: number; resets_at: string | null };
  seven_day: { utilization: number; resets_at: string | null };
  extra_usage: { monthly_limit: number; used_credits: number; utilization: number } | null;
}

interface ClaudeStats {
  totalSessions: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  peakHour: number | null;
  allTimeDailyCounts: Record<string, number>;
  allTimeDailyModelTokens: Record<string, Record<string, number>>;
  modelBreakdown: {
    model: string; cost: number; costContent: number; costCache: number;
    inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number;
  }[];
}

interface StatsData {
  repos: RepoEntry[];
  claude: ClaudeStats;
}

type TabType = "overview" | "models";
type FilterType = "all" | "30d" | "7d";

const MODEL_COLORS = ["#3b82f6", "#60a5fa", "#93c5fd", "#1d4ed8", "#bfdbfe"];

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function fmtCost(usd: number): string {
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(2)}`;
}
function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}
function fmtResetsAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return "now";
  const totalMins = Math.floor(diff / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 24) {
    const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true }).replace(/:00/, "").toLowerCase();
    return `${weekday} ${time}`;
  }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function dateAgo(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function sessionDisplayName(s: UsageSession): string {
  if (s.resolvedPath) return s.resolvedPath.split("/").filter(Boolean).pop() ?? s.sessionId;
  return s.sessionId.replace(/^-Users-[^-]+-Documents-GitHub-/, "") || s.sessionId;
}
function getRepoKey(s: UsageSession): string {
  if (s.resolvedPath) {
    const parts = s.resolvedPath.split("/").filter(Boolean);
    const ghIdx = parts.indexOf("GitHub");
    if (ghIdx >= 0 && parts[ghIdx + 1]) return parts[ghIdx + 1];
    return parts[parts.length - 1];
  }
  const m = s.sessionId.match(/^-Users-[^-]+-Documents-GitHub-(.+)$/);
  return m ? m[1] : s.sessionId;
}
function shortModelName(model: string): string {
  if (model.startsWith("<") || model === "unknown") return "Internal";
  const ver = model.match(/(\d+\.\d+)/)?.[1] ?? "";
  if (model.includes("opus")) return `Opus ${ver}`;
  if (model.includes("sonnet")) return `Sonnet ${ver}`;
  if (model.includes("haiku")) return `Haiku ${ver}`;
  return model.slice(0, 14);
}
function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

interface MergedSession extends UsageSession { mergedCount: number }
function mergeSessions(sessions: UsageSession[]): MergedSession[] {
  const groups = new Map<string, MergedSession>();
  for (const s of sessions) {
    const key = getRepoKey(s);
    const existing = groups.get(key);
    if (existing) {
      existing.totalCost += s.totalCost;
      existing.totalTokens += s.totalTokens;
      existing.inputTokens += s.inputTokens;
      existing.outputTokens += s.outputTokens;
      existing.mergedCount++;
      if (s.lastActivity > existing.lastActivity) existing.lastActivity = s.lastActivity;
      if (!existing.resolvedPath && s.resolvedPath) existing.resolvedPath = s.resolvedPath;
    } else {
      groups.set(key, { ...s, mergedCount: 1 });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.totalCost - a.totalCost);
}

function Ring({ pct, color, label, sub, t }: { pct: number; color: string; label: string; sub: string; t: Theme }) {
  const r = 36; const stroke = 6;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(pct, 100) / 100);
  const textColor = pct >= 90 ? t.red : pct >= 70 ? t.orange : color;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1 }}>
      <div style={{ position: "relative", width: 88, height: 88 }}>
        <svg width={88} height={88} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={44} cy={44} r={r} fill="none" stroke={t.surface3} strokeWidth={stroke} />
          <circle cx={44} cy={44} r={r} fill="none"
            stroke={textColor} strokeWidth={stroke}
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.8s ease" }}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: textColor, fontFamily: "monospace", lineHeight: 1 }}>
            {Math.round(pct)}%
          </span>
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: t.label1 }}>{label}</div>
        <div style={{ fontSize: 11, color: t.label3, fontFamily: "monospace", marginTop: 1 }}>{sub}</div>
      </div>
    </div>
  );
}

function RepoChart({ repos, t }: { repos: RepoEntry[]; t: Theme }) {
  const maxVisits = Math.max(...repos.map((r) => r.visits), 1);
  const COLORS = [t.blue, t.green, t.purple, t.red, t.orange, t.teal];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {repos.map((r, i) => {
        const pct = (r.visits / maxVisits) * 100;
        const color = COLORS[i % COLORS.length];
        return (
          <div key={r.name}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 12, color: t.label1, fontFamily: "monospace" }}>{r.name}</span>
              <span style={{ fontSize: 11, color: t.label3, fontFamily: "monospace" }}>
                {r.visits} visit{r.visits !== 1 ? "s" : ""} · {timeAgo(r.lastSeen)}
              </span>
            </div>
            <div style={{ height: 4, background: t.surface3, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.6s ease" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, t }: { label: string; value: string | number; t: Theme }) {
  return (
    <div style={{
      background: t.surface2, border: `1px solid ${t.borderMid}`,
      borderRadius: 8, padding: "10px 12px", flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: t.label3, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: t.label1, fontFamily: "monospace", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function ActivityHeatmap({ dailyCounts, t }: { dailyCounts: Record<string, number>; t: Theme }) {
  const WEEKS = 16;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const start = new Date(today);
  start.setDate(start.getDate() - WEEKS * 7 + 1);
  const dow = start.getDay();
  start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1));

  const weeks: { date: string; count: number }[][] = [];
  let week: { date: string; count: number }[] = [];
  const d = new Date(start);
  while (d.toISOString().slice(0, 10) <= todayStr) {
    const ds = d.toISOString().slice(0, 10);
    week.push({ date: ds, count: dailyCounts[ds] ?? 0 });
    if (week.length === 7) { weeks.push(week); week = []; }
    d.setDate(d.getDate() + 1);
  }
  if (week.length > 0) weeks.push(week);

  const startStr = start.toISOString().slice(0, 10);
  const maxCount = Math.max(
    ...Object.entries(dailyCounts).filter(([dt]) => dt >= startStr).map(([, c]) => c),
    1
  );

  const cellColor = (count: number) => {
    if (count === 0) return t.surface3;
    const i = count / maxCount;
    if (i < 0.2) return "rgba(59,130,246,0.2)";
    if (i < 0.4) return "rgba(59,130,246,0.4)";
    if (i < 0.6) return "rgba(59,130,246,0.6)";
    if (i < 0.8) return "rgba(59,130,246,0.8)";
    return "rgba(59,130,246,1.0)";
  };

  return (
    <div style={{ display: "flex", gap: 2 }}>
      {weeks.map((wk, wi) => (
        <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {wk.map((day, di) => (
            <div
              key={di}
              title={`${day.date}: ${day.count} msg`}
              style={{ width: 10, height: 10, borderRadius: 2, background: cellColor(day.count) }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function ModelBarChart({
  dailyModelTokens, models, t, filter,
}: {
  dailyModelTokens: Record<string, Record<string, number>>;
  models: string[];
  t: Theme;
  filter: FilterType;
}) {
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; date: string; values: Record<string, number>;
  } | null>(null);

  const cutoff = filter === "7d"
    ? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    : filter === "30d"
    ? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    : null;

  const dates = Object.keys(dailyModelTokens).filter(d => !cutoff || d >= cutoff).sort();

  // Compute legend from the same filtered dates so it updates with the filter
  const filteredTotals = models.map(m => ({
    model: m,
    tokens: dates.reduce((s, d) => s + (dailyModelTokens[d]?.[m] ?? 0), 0),
  })).filter(m => m.tokens > 0);
  const filteredGrandTotal = filteredTotals.reduce((s, m) => s + m.tokens, 0);

  const W = 444, H = 150;
  const ML = 46, MR = 6, MT = 8, MB = 28;
  const cW = W - ML - MR, cH = H - MT - MB;

  const totals = dates.map(d =>
    models.reduce((s, m) => s + (dailyModelTokens[d]?.[m] ?? 0), 0)
  );
  const maxTotal = Math.max(...totals, 1);

  const step = dates.length > 0 ? cW / dates.length : cW;
  const barW = Math.max(2, Math.min(step - 1, 12));

  const yFmt = (v: number) =>
    v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` :
    v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(Math.round(v));

  const xStep = Math.ceil(dates.length / 8);

  return (
    <div style={{ position: "relative" }}>
      <svg width={W} height={H} style={{ display: "block" }}>
        <g transform={`translate(${ML},${MT})`}>
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
            const y = cH - p * cH;
            return (
              <g key={i}>
                <line x1={0} y1={y} x2={cW} y2={y} stroke={t.borderSubtle ?? t.border} strokeWidth={0.5} />
                <text x={-4} y={y + 3} textAnchor="end" fontSize={8} fill={t.label3}>{yFmt(p * maxTotal)}</text>
              </g>
            );
          })}

          {dates.map((date, di) => {
            const x = di * step + (step - barW) / 2;
            let stackY = cH;
            return (
              <g key={date}
                onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, date, values: dailyModelTokens[date] ?? {} })}
                onMouseLeave={() => setTooltip(null)}
                style={{ cursor: "default" }}
              >
                {models.map((model, mi) => {
                  const v = dailyModelTokens[date]?.[model] ?? 0;
                  if (!v) return null;
                  const bH = Math.max(2, (v / maxTotal) * cH);
                  stackY -= bH;
                  return (
                    <rect key={model} x={x} y={stackY} width={barW} height={bH}
                      fill={MODEL_COLORS[mi % MODEL_COLORS.length]} rx={1} />
                  );
                })}
              </g>
            );
          })}

          {dates.map((date, di) => {
            if (di % xStep !== 0) return null;
            const x = di * step + step / 2;
            const dd = new Date(date + "T12:00:00");
            const lbl = `${dd.toLocaleString("en-US", { month: "short" })} ${dd.getDate()}`;
            return (
              <text key={date} x={x} y={cH + 16} textAnchor="middle" fontSize={8} fill={t.label3}>{lbl}</text>
            );
          })}
        </g>
      </svg>

      {tooltip && (
        <div style={{
          position: "fixed", left: tooltip.x + 12, top: tooltip.y - 50,
          background: t.surface2, border: `1px solid ${t.borderMid}`,
          borderRadius: 6, padding: "6px 10px", fontSize: 11, zIndex: 9999,
          pointerEvents: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontWeight: 700, color: t.label1, marginBottom: 4, fontFamily: "monospace" }}>{tooltip.date}</div>
          {models.filter(m => tooltip.values[m]).map((m, mi) => (
            <div key={m} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
              <div style={{ width: 8, height: 8, borderRadius: 1, background: MODEL_COLORS[mi % MODEL_COLORS.length], flexShrink: 0 }} />
              <span style={{ color: t.label2 ?? t.label1, fontFamily: "monospace" }}>
                {shortModelName(m)} {fmtTokens(tooltip.values[m])}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Legend — computed from the same filtered dates */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        {filteredTotals.map((m, mi) => {
          const pct = filteredGrandTotal > 0 ? (m.tokens / filteredGrandTotal * 100).toFixed(1) : "0";
          return (
            <div key={m.model} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: MODEL_COLORS[mi % MODEL_COLORS.length], flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: t.label1, minWidth: 90 }}>{shortModelName(m.model)}</span>
              <span style={{ fontSize: 11, color: t.label3, fontFamily: "monospace", flex: 1 }}>
                {fmtTokens(m.tokens)}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: t.label1, fontFamily: "monospace", minWidth: 42, textAlign: "right" }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props { onClose: () => void; onOpenSession: (path: string) => void; }

export function StatsDrawer({ onClose, onOpenSession }: Props) {
  const { theme: t } = useTheme();
  const [data, setData] = useState<StatsData | null>(null);
  const [sessions, setSessions] = useState<UsageSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [limits, setLimits] = useState<ClaudeLimits | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<TabType>("overview");
  const [filter, setFilter] = useState<FilterType>("all");

  useEffect(() => {
    setData(null); setLimitsLoading(true); setSessionsLoading(true);
    const now = new Date().toISOString().slice(0, 7);
    window.terminal.getStats(now).then((d) => setData({ repos: d.repos, claude: d.claude as ClaudeStats }));
    window.terminal.getClaudeLimits().then((l) => { setLimits(l); setLimitsLoading(false); }).catch(() => setLimitsLoading(false));
    window.terminal.getUsageSessions().then((s) => { setSessions(s); setSessionsLoading(false); }).catch(() => setSessionsLoading(false));
  }, [refreshKey]);

  const card = { background: t.surface2, border: `1px solid ${t.borderMid}`, borderRadius: 10, padding: "12px 14px" };

  const SectionLabel = ({ icon, title, sub, color }: { icon: string; title: string; sub?: string; color?: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ color: color ?? t.green, fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: t.label1 }}>{title}</span>
      {sub && <span style={{ fontSize: 11, color: t.label3 }}>· {sub}</span>}
    </div>
  );

  const mergedSessions = mergeSessions(sessions);
  const maxCost = Math.max(...mergedSessions.map((s) => s.totalCost), 0.01);

  const claude = data?.claude;

  // Filtered overview stats — recomputed from daily data when filter changes
  const overviewCutoff = filter === "7d"
    ? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    : filter === "30d"
    ? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    : null;

  const totalMessages = claude
    ? Object.entries(claude.allTimeDailyCounts)
        .filter(([d]) => !overviewCutoff || d >= overviewCutoff)
        .reduce((s, [, c]) => s + c, 0)
    : 0;
  const totalTokens = claude
    ? Object.entries(claude.allTimeDailyModelTokens)
        .filter(([d]) => !overviewCutoff || d >= overviewCutoff)
        .reduce((s, [, models]) => s + Object.values(models).reduce((ss, v) => ss + v, 0), 0)
    : 0;
  const activeDays = claude
    ? Object.entries(claude.allTimeDailyCounts)
        .filter(([d, c]) => (!overviewCutoff || d >= overviewCutoff) && c > 0).length
    : 0;
  const favoriteModel = claude
    ? (() => {
        const totals: Record<string, number> = {};
        Object.entries(claude.allTimeDailyModelTokens)
          .filter(([d]) => !overviewCutoff || d >= overviewCutoff)
          .forEach(([, ms]) => Object.entries(ms).forEach(([m, v]) => { totals[m] = (totals[m] ?? 0) + v; }));
        const top = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
        return top ? shortModelName(top[0]) : "—";
      })()
    : "—";
  const allModels = claude
    ? Array.from(new Set(Object.values(claude.allTimeDailyModelTokens).flatMap(d => Object.keys(d))))
    : [];
  // Sort models by total tokens descending
  const sortedModels = allModels.sort((a, b) => {
    const sumA = Object.values(claude!.allTimeDailyModelTokens).reduce((s, d) => s + (d[a] ?? 0), 0);
    const sumB = Object.values(claude!.allTimeDailyModelTokens).reduce((s, d) => s + (d[b] ?? 0), 0);
    return sumB - sumA;
  });

  const btnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? t.surface3 : "none",
    border: `1px solid ${active ? t.borderMid : "transparent"}`,
    borderRadius: 5, color: active ? t.label1 : t.label3,
    cursor: "pointer", fontSize: 12, padding: "3px 10px",
    transition: "all 0.12s",
  });

  return (
    <div style={{
      width: 480, flexShrink: 0,
      background: t.surface1,
      backdropFilter: t.backdropFilter,
      WebkitBackdropFilter: t.backdropFilter,
      borderLeft: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column",
      boxShadow: t.isDark ? "-8px 0 40px rgba(0,0,0,0.6)" : "-8px 0 24px rgba(0,0,0,0.08)",
      WebkitAppRegion: "no-drag" as const,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: `1px solid ${t.border}`,
        background: t.headerBg, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15, color: t.green }}>◈</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: t.label1 }}>Stats</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setRefreshKey((k) => k + 1)} title="Refresh" style={{
            background: "none", border: `1px solid ${t.borderMid}`,
            borderRadius: 4, color: t.label3, cursor: "pointer", fontSize: 12, padding: "2px 8px", transition: "color 0.15s",
          }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
          >↺</button>
          <button onClick={onClose} style={{
            background: "none", border: `1px solid ${t.borderMid}`,
            borderRadius: 4, color: t.label3, cursor: "pointer", fontSize: 12, padding: "2px 8px", transition: "color 0.15s",
          }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
          >✕</button>
        </div>
      </div>

      {/* Tab bar + filter */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 16px", borderBottom: `1px solid ${t.border}`,
        background: t.headerBg, flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 2 }}>
          {(["overview", "models"] as TabType[]).map(tb => (
            <button key={tb} onClick={() => setTab(tb)} style={btnStyle(tab === tb)}>
              {tb.charAt(0).toUpperCase() + tb.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {(["all", "30d", "7d"] as FilterType[]).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={btnStyle(filter === f)}>
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 20 }}>

        {tab === "overview" && (
          <>
            {/* Stat cards */}
            {claude ? (
              <section>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <StatCard label="Sessions" value={claude.totalSessions} t={t} />
                  <StatCard label="Messages" value={totalMessages.toLocaleString()} t={t} />
                  <StatCard label="Total tokens" value={fmtTokens(totalTokens)} t={t} />
                  <StatCard label="Active days" value={activeDays} t={t} />
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  <StatCard label="Current streak" value={`${claude.currentStreak}d`} t={t} />
                  <StatCard label="Longest streak" value={`${claude.longestStreak}d`} t={t} />
                  <StatCard label="Peak hour" value={claude.peakHour !== null ? formatHour(claude.peakHour) : "—"} t={t} />
                  <StatCard label="Favorite model" value={favoriteModel} t={t} />
                </div>
                {/* Heatmap */}
                <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 10, color: t.label3, fontFamily: "monospace" }}>activity · last 16 weeks</div>
                  <ActivityHeatmap dailyCounts={claude.allTimeDailyCounts} t={t} />
                </div>
              </section>
            ) : (
              <div style={{ color: t.label3, fontSize: 12 }}>Loading…</div>
            )}

            {/* Usage Limits */}
            <section>
              <SectionLabel icon="◆" title="Usage Limits" sub="live · claude.ai" color={t.blue} />
              {limitsLoading ? (
                <div style={{ color: t.label3, fontSize: 12, padding: "8px 0" }}>Fetching limits…</div>
              ) : !limits ? (
                <div style={{ color: t.label3, fontSize: 12, padding: "8px 0", lineHeight: 1.6 }}>
                  Could not load usage limits.<br />
                  <span style={{ fontSize: 11 }}>Requires: <code style={{ color: t.orange }}>pip3 install cryptography</code> and Chrome logged into claude.ai</span>
                </div>
              ) : (
                <div style={card}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "space-around" }}>
                    <Ring pct={limits.five_hour.utilization} color={t.blue} label="Session"
                      sub={limits.five_hour.resets_at ? `resets in ${fmtResetsAt(limits.five_hour.resets_at)}` : "—"} t={t} />
                    <Ring pct={limits.seven_day.utilization} color={t.green} label="Weekly"
                      sub={limits.seven_day.resets_at ? `resets in ${fmtResetsAt(limits.seven_day.resets_at)}` : "—"} t={t} />
                    {limits.extra_usage && (
                      <Ring pct={limits.extra_usage.utilization} color={t.purple} label="Extra"
                        sub={`$${limits.extra_usage.used_credits.toFixed(0)}/$${limits.extra_usage.monthly_limit}`} t={t} />
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* GitHub Repos */}
            <section>
              <SectionLabel icon="⎇" title="GitHub Repos" />
              {data ? (
                <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                    <div style={{
                      background: t.surface2, border: `1px solid ${t.borderMid}`,
                      borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 0,
                    }}>
                      <div style={{ fontSize: 10, color: t.label3, marginBottom: 4 }}>Top repo</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: t.green, fontFamily: "monospace", lineHeight: 1 }}>{data.repos[0]?.name ?? "—"}</div>
                      {data.repos[0] && <div style={{ fontSize: 11, color: t.label3, marginTop: 4 }}>{data.repos[0].visits} visits</div>}
                    </div>
                    <div style={{
                      background: t.surface2, border: `1px solid ${t.borderMid}`,
                      borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 0,
                    }}>
                      <div style={{ fontSize: 10, color: t.label3, marginBottom: 4 }}>Repos tracked</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: t.label1, fontFamily: "monospace", lineHeight: 1 }}>{data.repos.length}</div>
                      <div style={{ fontSize: 11, color: t.label3, marginTop: 4 }}>unique repos visited</div>
                    </div>
                  </div>
                  <div style={card}>
                    <div style={{ fontSize: 11, color: t.label3, marginBottom: 10, fontFamily: "monospace" }}>visits since first launch · ~/Documents/GitHub/</div>
                    {data.repos.length > 0
                      ? <RepoChart repos={data.repos} t={t} />
                      : <div style={{ color: t.label3, fontSize: 12, padding: "8px 0" }}>No repo visits tracked yet.</div>
                    }
                  </div>
                </>
              ) : (
                <div style={{ color: t.label3, fontSize: 12, padding: "8px 0" }}>Loading…</div>
              )}
            </section>
          </>
        )}

        {tab === "models" && (
          <>
            {/* Bar chart */}
            <section>
              <SectionLabel icon="▦" title="Token Usage by Model" sub={filter === "all" ? "all time" : filter} color={t.blue} />
              {claude ? (
                <div style={card}>
                  <ModelBarChart
                    dailyModelTokens={claude.allTimeDailyModelTokens}
                    models={sortedModels}
                    t={t}
                    filter={filter}
                  />
                </div>
              ) : (
                <div style={{ color: t.label3, fontSize: 12, padding: "8px 0" }}>Loading…</div>
              )}
            </section>

            {/* Claude Sessions */}
            <section>
              <SectionLabel icon="◈" title="Claude Sessions" sub="via ccusage · click to open" color={t.teal} />
              {sessionsLoading ? (
                <div style={{ color: t.label3, fontSize: 12, padding: "8px 0" }}>Loading sessions…</div>
              ) : mergedSessions.length === 0 ? (
                <div style={{ color: t.label3, fontSize: 12, padding: "8px 0", lineHeight: 1.6 }}>
                  No session data found.<br />
                  <span style={{ fontSize: 11 }}>Requires: <code style={{ color: t.orange }}>npm install -g ccusage</code></span>
                </div>
              ) : (
                <div style={card}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {mergedSessions.slice(0, 20).map((s) => {
                      const name = sessionDisplayName(s);
                      const pct = (s.totalCost / maxCost) * 100;
                      const canOpen = s.resolvedPath !== null;
                      return (
                        <div
                          key={s.sessionId}
                          onClick={() => canOpen && onOpenSession(s.resolvedPath!)}
                          style={{
                            padding: "8px 10px", borderRadius: 7,
                            background: t.surface3, border: `1px solid ${t.borderSubtle}`,
                            cursor: canOpen ? "pointer" : "default", transition: "background 0.15s",
                          }}
                          onMouseEnter={(e) => { if (canOpen) (e.currentTarget as HTMLDivElement).style.background = t.surface2; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = t.surface3; }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 5 }}>
                            <div style={{ minWidth: 0 }}>
                              <span style={{
                                fontSize: 12, fontWeight: 600, color: canOpen ? t.label1 : t.label3,
                                fontFamily: "monospace", display: "block",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260,
                              }}>{name}</span>
                              <span style={{ fontSize: 10, color: t.label3, fontFamily: "monospace" }}>
                                {dateAgo(s.lastActivity)} · {fmtTokens(s.totalTokens)}
                                {s.mergedCount > 1 && <span style={{ marginLeft: 6, color: t.purple, fontSize: 9 }}>+{s.mergedCount - 1} merged</span>}
                              </span>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: t.green, fontFamily: "monospace" }}>{fmtCost(s.totalCost)}</span>
                              {canOpen && <span style={{ fontSize: 9, color: t.label3, display: "block" }}>↗ open</span>}
                            </div>
                          </div>
                          <div style={{ height: 3, background: t.surface2, borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: t.blue, borderRadius: 2, transition: "width 0.6s ease" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${t.borderSubtle}`, display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, color: t.label3 }}>Total ({mergedSessions.length} projects · {sessions.length} sessions)</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: t.label1, fontFamily: "monospace" }}>
                      {fmtCost(mergedSessions.reduce((sum, x) => sum + x.totalCost, 0))}
                    </span>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
