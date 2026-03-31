import React, { useEffect, useState } from "react";

interface DailyCount { date: string; count: number }
interface DailyTokens { date: string; tokens: number }
interface RepoEntry { name: string; visits: number; lastSeen: number }

interface StatsData {
  claude: {
    currentMonth: string;
    totalSessions: number;
    monthSessions: number;
    totalMessages: number;
    monthMessages: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheCreationTokens: number;
    monthInputTokens: number;
    monthOutputTokens: number;
    monthCacheReadTokens: number;
    monthCacheCreationTokens: number;
    dailyCounts: DailyCount[];
    dailyTokens: DailyTokens[];
  };
  repos: RepoEntry[];
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return new Date(+y, +m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(3)}¢`;
  return `$${usd.toFixed(2)}`;
}

function shortModel(model: string): string {
  if (model.includes("opus"))   return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku"))  return "Haiku";
  return model;
}

interface Props {
  onClose: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

// ── Token gauge (progress bar) ────────────────────────────────────────────────
function TokenGauge({ label, used, total, color }: { label: string; used: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const danger = pct > 80;
  const warn = pct > 60;
  const barColor = danger ? "#f85149" : warn ? "#ffa657" : color;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#8b949e" }}>{label}</span>
        <span style={{ fontSize: 11, color: barColor, fontFamily: "'DM Mono', monospace" }}>
          {fmtTokens(used)} / {fmtTokens(total)}
        </span>
      </div>
      <div style={{ height: 8, background: "rgba(0, 255, 135, 0.07)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: 4,
          background: `linear-gradient(90deg, ${barColor}99, ${barColor})`,
          boxShadow: `0 0 8px ${barColor}66`,
          transition: "width 0.6s ease",
        }} />
      </div>
    </div>
  );
}

// ── Mini bar chart (SVG) ──────────────────────────────────────────────────────
function BarChart({ data }: { data: DailyCount[] }) {
  const W = 420;
  const H = 80;
  const gap = 3;
  const n = data.length;
  const barW = (W - gap * (n - 1)) / n;
  const maxVal = Math.max(...data.map((d) => d.count), 1);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H + 24} style={{ display: "block" }}>
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#58a6ff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#1f6feb" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="barGradHot" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bc8cff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#6e40c9" stopOpacity="0.7" />
          </linearGradient>
        </defs>
        {data.map((d, i) => {
          const bh = Math.max((d.count / maxVal) * H, d.count > 0 ? 3 : 0);
          const x = i * (barW + gap);
          const y = H - bh;
          const isMax = d.count === maxVal && d.count > 0;
          const isToday = i === data.length - 1;
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={bh}
                rx={2}
                fill={isMax ? "url(#barGradHot)" : "url(#barGrad)"}
                opacity={d.count === 0 ? 0.15 : 1}
              />
              {/* Empty slot marker */}
              {d.count === 0 && (
                <rect x={x} y={H - 2} width={barW} height={2} rx={1} fill="rgba(0, 255, 135, 0.1)" />
              )}
              {/* Count label on top for non-zero */}
              {d.count > 0 && bh > 14 && (
                <text
                  x={x + barW / 2}
                  y={y + 11}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#e6edf3"
                  fontFamily="DM Mono, monospace"
                >
                  {d.count}
                </text>
              )}
              {/* Date label below */}
              {(isToday || i % 2 === 0) && (
                <text
                  x={x + barW / 2}
                  y={H + 16}
                  textAnchor="middle"
                  fontSize={9}
                  fill={isToday ? "#58a6ff" : "#8b949e"}
                  fontFamily="DM Mono, monospace"
                >
                  {isToday ? "today" : formatDate(d.date).replace(" ", "\u00a0")}
                </text>
              )}
            </g>
          );
        })}
        {/* Baseline */}
        <line x1={0} y1={H} x2={W} y2={H} stroke="rgba(0, 255, 135, 0.1)" strokeWidth={1} />
      </svg>
    </div>
  );
}

// ── Token bar chart ───────────────────────────────────────────────────────────
function TokenBarChart({ data }: { data: DailyTokens[] }) {
  const W = 420;
  const H = 70;
  const gap = 3;
  const n = data.length;
  const barW = (W - gap * (n - 1)) / n;
  const maxVal = Math.max(...data.map((d) => d.tokens), 1);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H + 24} style={{ display: "block" }}>
        <defs>
          <linearGradient id="tokGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffa657" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#d4591e" stopOpacity="0.6" />
          </linearGradient>
        </defs>
        {data.map((d, i) => {
          const bh = Math.max((d.tokens / maxVal) * H, d.tokens > 0 ? 3 : 0);
          const x = i * (barW + gap);
          const y = H - bh;
          const isToday = i === data.length - 1;
          return (
            <g key={d.date}>
              <rect x={x} y={y} width={barW} height={bh} rx={2}
                fill={isToday ? "#ffa657" : "url(#tokGrad)"} opacity={d.tokens === 0 ? 0.12 : 1} />
              {d.tokens === 0 && (
                <rect x={x} y={H - 2} width={barW} height={2} rx={1} fill="rgba(0, 255, 135, 0.1)" />
              )}
              {(isToday || i % 2 === 0) && (
                <text x={x + barW / 2} y={H + 16} textAnchor="middle" fontSize={9}
                  fill={isToday ? "#ffa657" : "#8b949e"} fontFamily="DM Mono, monospace">
                  {isToday ? "today" : formatDate(d.date).replace(" ", "\u00a0")}
                </text>
              )}
            </g>
          );
        })}
        <line x1={0} y1={H} x2={W} y2={H} stroke="rgba(0, 255, 135, 0.1)" strokeWidth={1} />
      </svg>
    </div>
  );
}

// ── Horizontal bar chart for repos ────────────────────────────────────────────
function RepoChart({ repos }: { repos: RepoEntry[] }) {
  const maxVisits = Math.max(...repos.map((r) => r.visits), 1);
  const COLORS = ["#58a6ff", "#3fb950", "#bc8cff", "#f78166", "#ffa657", "#39d353", "#79c0ff"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {repos.map((r, i) => {
        const pct = (r.visits / maxVisits) * 100;
        const color = COLORS[i % COLORS.length];
        return (
          <div key={r.name}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 12, color: "#e6edf3", fontFamily: "'DM Mono', monospace" }}>
                {r.name}
              </span>
              <span style={{ fontSize: 11, color: "#8b949e", fontFamily: "'DM Mono', monospace" }}>
                {r.visits} visit{r.visits !== 1 ? "s" : ""} · {timeAgo(r.lastSeen)}
              </span>
            </div>
            <div
              style={{
                height: 6,
                background: "rgba(0, 255, 135, 0.07)",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: color,
                  borderRadius: 3,
                  transition: "width 0.6s ease",
                  boxShadow: `0 0 6px ${color}88`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent: string }) {
  return (
    <div
      style={{
        background: "rgba(0, 255, 135, 0.05)",
        border: `1px solid ${accent}22`,
        backdropFilter: "blur(8px)",
        borderRadius: 8,
        padding: "12px 16px",
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, color: "rgba(0,210,120,0.28)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontFamily: "'Syne', sans-serif" }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "#8b949e", marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

const LIMIT_KEY = "td_token_limit";

const navBtnStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid rgba(0, 255, 135, 0.16)",
  borderRadius: 4,
  color: "rgba(0,240,128,0.45)",
  cursor: "pointer",
  fontSize: 14,
  padding: "1px 8px",
  lineHeight: 1.4,
  fontFamily: "'DM Mono', monospace",
};

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function parseLimit(s: string): number {
  const t = s.trim().toUpperCase();
  if (t.endsWith("M")) return parseFloat(t) * 1_000_000;
  if (t.endsWith("K")) return parseFloat(t) * 1_000;
  return parseInt(t, 10) || 0;
}

// ── Main drawer ───────────────────────────────────────────────────────────────
export function StatsDrawer({ onClose }: Props) {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth);
  const [limitInput, setLimitInput] = useState(() => localStorage.getItem(LIMIT_KEY) ?? "");
  const [editingLimit, setEditingLimit] = useState(false);
  const [showCostDetails, setShowCostDetails] = useState(false);

  const tokenLimit = parseLimit(limitInput);
  const isCurrentMonth = selectedMonth === currentYearMonth();

  function saveLimit(val: string) {
    setLimitInput(val);
    localStorage.setItem(LIMIT_KEY, val);
    setEditingLimit(false);
  }

  function navigate(month: string) {
    setSelectedMonth(month);
    setData(null);
    setLoading(true);
    window.terminal.getStats(month).then((d) => {
      setData(d);
      setLoading(false);
    });
  }

  useEffect(() => {
    window.terminal.getStats(selectedMonth).then((d) => {
      setData(d);
      setLoading(false);
    });
  }, []);

  const activeDays = data?.claude.dailyCounts.filter((d) => d.count > 0).length ?? 0;
  const topRepo = data?.repos[0]?.name ?? "—";
  const avgPerDay = data
    ? (data.claude.monthMessages / Math.max(activeDays, 1)).toFixed(1)
    : "—";
  const monthTitle = data ? monthLabel(data.claude.currentMonth) : "";

  return (
    <div
      style={{
        width: 480,
        flexShrink: 0,
        background: "rgba(10, 26, 15, 0.84)",
        backdropFilter: "blur(28px) saturate(160%)",
        WebkitBackdropFilter: "blur(28px) saturate(160%)",
        borderLeft: "1px solid rgba(0, 255, 135, 0.12)",
        display: "flex",
        flexDirection: "column",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.5)",
        WebkitAppRegion: "no-drag" as const,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid rgba(0, 255, 135, 0.1)",
          background: "rgba(8, 20, 12, 0.5)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, color: "#00f080" }}>◈</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#e2fff3", fontFamily: "'Syne', sans-serif" }}>Stats</span>
        </div>

        {/* Month navigator */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => navigate(prevMonth(selectedMonth))} style={navBtnStyle}>‹</button>
          <span style={{ fontSize: 12, color: "#8b949e", minWidth: 90, textAlign: "center", fontFamily: "'DM Mono', monospace" }}>
            {monthLabel(selectedMonth)}
          </span>
          <button
            onClick={() => navigate(nextMonth(selectedMonth))}
            disabled={isCurrentMonth}
            style={{ ...navBtnStyle, opacity: isCurrentMonth ? 0.3 : 1, cursor: isCurrentMonth ? "default" : "pointer" }}
          >›</button>
          {!isCurrentMonth && (
            <button onClick={() => navigate(currentYearMonth())} style={{ ...navBtnStyle, fontSize: 10, padding: "2px 6px" }}>
              now
            </button>
          )}
        </div>

        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "1px solid #30363d",
            borderRadius: 4,
            color: "#8b949e",
            cursor: "pointer",
            fontSize: 12,
            padding: "2px 8px",
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 20 }}>
        {loading ? (
          <div style={{ color: "#8b949e", fontSize: 13, textAlign: "center", paddingTop: 40 }}>
            Loading stats…
          </div>
        ) : data ? (
          <>
            {/* ── Claude Stats ── */}
            <section>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ color: "#00f080", fontSize: 14 }}>◆</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#e2fff3", fontFamily: "'Syne', sans-serif" }}>Claude Usage</span>
                <span style={{ fontSize: 11, color: "#8b949e", fontWeight: 400 }}>· {monthTitle}</span>
              </div>

              {/* Stat cards */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <StatCard
                  label="Sessions"
                  value={data.claude.monthSessions}
                  sub={`${data.claude.totalSessions} all-time`}
                  accent="#bc8cff"
                />
                <StatCard
                  label="Messages"
                  value={data.claude.monthMessages.toLocaleString()}
                  sub={`~${avgPerDay} / active day`}
                  accent="#58a6ff"
                />
                <StatCard
                  label="Active Days"
                  value={activeDays}
                  sub="this month"
                  accent="#3fb950"
                />
              </div>

              {/* Bar chart */}
              <div
                style={{
                  background: "rgba(0, 255, 135, 0.05)",
                  border: "1px solid rgba(0, 255, 135, 0.1)",
                  borderRadius: 8,
                  padding: "12px 12px 8px",
                }}
              >
                <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 8, fontFamily: "'DM Mono', monospace" }}>
                  messages / day — {monthTitle}
                </div>
                {data.claude.dailyCounts.length > 0 ? (
                  <BarChart data={data.claude.dailyCounts} />
                ) : (
                  <div style={{ color: "#8b949e", fontSize: 12, padding: "16px 0" }}>
                    No session data found in ~/.claude/sessions/
                  </div>
                )}
              </div>
            </section>

            {/* ── Token Usage ── */}
            <section>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ color: "#00f080", fontSize: 14 }}>◆</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#e2fff3", fontFamily: "'Syne', sans-serif" }}>Token Usage</span>
                <span style={{ fontSize: 11, color: "#8b949e", fontWeight: 400 }}>· {monthTitle}</span>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <StatCard
                  label="Your Input"
                  value={fmtTokens(data.claude.monthInputTokens)}
                  sub="new text sent"
                  accent="#ffa657"
                />
                <StatCard
                  label="Output"
                  value={fmtTokens(data.claude.monthOutputTokens)}
                  sub="Claude's responses"
                  accent="#bc8cff"
                />
                <StatCard
                  label="Cache Overhead"
                  value={fmtTokens(data.claude.monthCacheReadTokens + data.claude.monthCacheCreationTokens)}
                  sub="not counted as usage"
                  accent="#8b949e"
                />
              </div>

              {/* Estimated cost */}
              <div style={{
                background: "rgba(0, 255, 135, 0.05)", border: "1px solid rgba(0, 255, 135, 0.1)",
                borderRadius: 8, padding: "12px 14px", marginBottom: 8,
              }}>
                {/* Header row — always visible */}
                <div
                  onClick={() => setShowCostDetails((v) => !v)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#8b949e", fontFamily: "'DM Mono', monospace" }}>
                      API equivalent value · {monthTitle}
                    </span>
                    <span style={{ fontSize: 10, color: "#8b949e", transition: "transform 0.2s", display: "inline-block", transform: showCostDetails ? "rotate(90deg)" : "rotate(0deg)" }}>
                      ›
                    </span>
                  </div>
                  <span style={{ fontSize: 22, fontWeight: 700, color: "#3fb950", fontFamily: "'DM Mono', monospace" }}>
                    {fmtCost(data.claude.estimatedCost)}
                  </span>
                </div>

                {/* Collapsible details */}
                {showCostDetails && (
                  <>
                    <div style={{ fontSize: 10, color: "#8b949e", margin: "8px 0" }}>
                      Pay-as-you-go API rates. Team/Max plan pays flat — this is a usage intensity indicator, not your bill.
                    </div>
                    {data.claude.modelBreakdown.map((m) => (
                      <div key={m.model} style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #21262d" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 3,
                            background: m.model.includes("opus") ? "#bc8cff22" : m.model.includes("haiku") ? "#3fb95022" : "#58a6ff22",
                            color: m.model.includes("opus") ? "#bc8cff" : m.model.includes("haiku") ? "#3fb950" : "#58a6ff",
                          }}>
                            {shortModel(m.model)}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#e6edf3", fontFamily: "'DM Mono', monospace" }}>
                            {fmtCost(m.cost)}
                          </span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingLeft: 4 }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 10, color: "#8b949e" }}>Input {fmtTokens(m.inputTokens)} + Output {fmtTokens(m.outputTokens)}</span>
                            <span style={{ fontSize: 10, color: "#ffa657", fontFamily: "'DM Mono', monospace" }}>{fmtCost(m.costContent)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 10, color: "#8b949e" }}>Cache write {fmtTokens(m.cacheWriteTokens)} + read {fmtTokens(m.cacheReadTokens)}</span>
                            <span style={{ fontSize: 10, color: "#8b949e", fontFamily: "'DM Mono', monospace" }}>{fmtCost(m.costCache)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* Token bar chart */}
              <div style={{
                background: "rgba(0, 255, 135, 0.05)", border: "1px solid rgba(0, 255, 135, 0.1)",
                borderRadius: 8, padding: "12px 12px 8px",
              }}>
                <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 8, fontFamily: "'DM Mono', monospace" }}>
                  tokens / day — {monthTitle}
                </div>
                {data.claude.dailyTokens.length > 0 ? (
                  <TokenBarChart data={data.claude.dailyTokens} />
                ) : (
                  <div style={{ color: "#8b949e", fontSize: 12, padding: "16px 0" }}>No token data.</div>
                )}
              </div>

              {/* Monthly limit gauge */}
              <div style={{
                background: "rgba(0, 255, 135, 0.05)", border: "1px solid rgba(0, 255, 135, 0.1)",
                borderRadius: 8, padding: "12px 14px", marginTop: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: "#8b949e", fontFamily: "'DM Mono', monospace" }}>
                    token limit / month
                  </span>
                  {editingLimit ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); saveLimit(limitInput); }}
                      style={{ display: "flex", gap: 4 }}
                    >
                      <input
                        autoFocus
                        value={limitInput}
                        onChange={(e) => setLimitInput(e.target.value)}
                        placeholder="e.g. 50M or 5000000"
                        style={{
                          background: "rgba(8, 20, 12, 0.85)", border: "1px solid rgba(0, 255, 135, 0.35)", borderRadius: 4,
                          color: "#e6edf3", fontSize: 11, padding: "2px 6px", width: 130,
                          outline: "none", fontFamily: "'DM Mono', monospace",
                        }}
                      />
                      <button type="submit" style={{
                        background: "#238636", border: "none", borderRadius: 4,
                        color: "#fff", fontSize: 11, cursor: "pointer", padding: "2px 8px",
                      }}>Save</button>
                      <button type="button" onClick={() => setEditingLimit(false)} style={{
                        background: "none", border: "1px solid #30363d", borderRadius: 4,
                        color: "#8b949e", fontSize: 11, cursor: "pointer", padding: "2px 6px",
                      }}>✕</button>
                    </form>
                  ) : (
                    <button onClick={() => setEditingLimit(true)} style={{
                      background: "none", border: "1px solid #30363d", borderRadius: 4,
                      color: "#8b949e", fontSize: 11, cursor: "pointer", padding: "2px 8px",
                    }}>
                      {tokenLimit > 0 ? `Edit (${fmtTokens(tokenLimit)})` : "Set limit"}
                    </button>
                  )}
                </div>
                {tokenLimit > 0 ? (
                  <>
                    <TokenGauge
                      label="Real usage vs limit (input + output)"
                      used={data.claude.monthInputTokens + data.claude.monthOutputTokens}
                      total={tokenLimit}
                      color="#ffa657"
                    />
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: "#8b949e", textAlign: "center", padding: "8px 0" }}>
                    Set your monthly token budget to see usage gauge
                  </div>
                )}
              </div>

              {/* Breakdown */}
              <div style={{
                background: "rgba(0, 255, 135, 0.05)", border: "1px solid rgba(0, 255, 135, 0.1)",
                borderRadius: 8, padding: "12px 14px", marginTop: 8,
              }}>
                <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 10, fontFamily: "'DM Mono', monospace" }}>
                  {monthTitle} · real vs overhead breakdown
                </div>
                {/* Real usage bar */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "#8b949e" }}>Real usage (input + output)</span>
                    <span style={{ fontSize: 11, color: "#ffa657", fontFamily: "'DM Mono', monospace" }}>
                      {fmtTokens(data.claude.monthInputTokens + data.claude.monthOutputTokens)}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid #21262d" }}>
                  <span style={{ fontSize: 11, color: "#8b949e" }}>Cache read (context overhead)</span>
                  <span style={{ fontSize: 11, color: "#8b949e", fontFamily: "'DM Mono', monospace" }}>
                    {fmtTokens(data.claude.monthCacheReadTokens)}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: "#8b949e" }}>Cache creation (overhead)</span>
                  <span style={{ fontSize: 11, color: "#8b949e", fontFamily: "'DM Mono', monospace" }}>
                    {fmtTokens(data.claude.monthCacheCreationTokens)}
                  </span>
                </div>
              </div>
            </section>

            {/* ── GitHub Repos ── */}
            <section>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ color: "#00f080", fontSize: 14 }}>◆</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#e2fff3", fontFamily: "'Syne', sans-serif" }}>GitHub Repos</span>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <StatCard
                  label="Top Repo"
                  value={topRepo}
                  sub={data.repos[0] ? `${data.repos[0].visits} visits` : undefined}
                  accent="#3fb950"
                />
                <StatCard
                  label="Repos Tracked"
                  value={data.repos.length}
                  sub="unique repos visited"
                  accent="#ffa657"
                />
              </div>

              <div
                style={{
                  background: "rgba(0, 255, 135, 0.05)",
                  border: "1px solid rgba(0, 255, 135, 0.1)",
                  borderRadius: 8,
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 10, fontFamily: "'DM Mono', monospace" }}>
                  visits since first launch · ~/Documents/GitHub/
                </div>
                {data.repos.length > 0 ? (
                  <RepoChart repos={data.repos} />
                ) : (
                  <div style={{ color: "#8b949e", fontSize: 12, padding: "8px 0" }}>
                    No repo visits tracked yet. Navigate to a ~/Documents/GitHub/ directory to start tracking.
                  </div>
                )}
              </div>
            </section>
          </>
        ) : (
          <div style={{ color: "#f85149", fontSize: 13, textAlign: "center", paddingTop: 40 }}>
            Failed to load stats.
          </div>
        )}
      </div>
    </div>
  );
}
