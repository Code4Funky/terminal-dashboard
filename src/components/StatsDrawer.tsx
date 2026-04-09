import React, { useEffect, useState } from "react";
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

interface StatsData {
  repos: RepoEntry[];
}

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
    return d.toLocaleDateString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
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
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: textColor, fontFamily: "monospace", lineHeight: 1 }}>
            {Math.round(pct)}%
          </span>
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: t.label1 }}>{label}</div>
        <div style={{ fontSize: 10, color: t.label3, fontFamily: "monospace", marginTop: 1 }}>{sub}</div>
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

function StatCard({ label, value, sub, accent, t }: { label: string; value: string | number; sub?: string; accent: string; t: Theme }) {
  return (
    <div style={{
      background: t.surface2, border: `1px solid ${t.borderMid}`,
      borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: t.label3, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, fontFamily: "monospace", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: t.label3, marginTop: 4 }}>{sub}</div>}
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

  useEffect(() => {
    const now = new Date().toISOString().slice(0, 7);
    window.terminal.getStats(now).then((d) => setData({ repos: d.repos }));
    window.terminal.getClaudeLimits().then((l) => {
      setLimits(l);
      setLimitsLoading(false);
    }).catch(() => setLimitsLoading(false));
    window.terminal.getUsageSessions().then((s) => {
      setSessions(s);
      setSessionsLoading(false);
    }).catch(() => setSessionsLoading(false));
  }, []);

  const topRepo = data?.repos[0]?.name ?? "—";
  const card = { background: t.surface2, border: `1px solid ${t.borderMid}`, borderRadius: 10, padding: "12px 14px" };

  const SectionLabel = ({ icon, title, sub }: { icon: string; title: string; sub?: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ color: t.green, fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: t.label1 }}>{title}</span>
      {sub && <span style={{ fontSize: 11, color: t.label3 }}>· {sub}</span>}
    </div>
  );

  const mergedSessions = mergeSessions(sessions);
  const maxCost = Math.max(...mergedSessions.map((s) => s.totalCost), 0.01);

  return (
    <div style={{
      width: 480, flexShrink: 0,
      background: t.surface1,
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
        <button onClick={onClose} style={{
          background: "none", border: `1px solid ${t.borderMid}`,
          borderRadius: 4, color: t.label3, cursor: "pointer", fontSize: 12, padding: "2px 8px",
        }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Usage Limits */}
        <section>
          <SectionLabel icon="◆" title="Usage Limits" sub="live · claude.ai" />
          {limitsLoading ? (
            <div style={{ color: t.label3, fontSize: 12, padding: "8px 0" }}>Fetching limits…</div>
          ) : !limits ? (
            <div style={{ color: t.label3, fontSize: 12, padding: "8px 0", lineHeight: 1.6 }}>
              Could not load usage limits.<br />
              <span style={{ color: t.label3, fontSize: 11 }}>
                Requires: <code style={{ color: t.orange }}>pip3 install cryptography</code> and Chrome logged into claude.ai
              </span>
            </div>
          ) : (
            <div style={card}>
              <div style={{ display: "flex", gap: 8, justifyContent: "space-around" }}>
                <Ring
                  pct={limits.five_hour.utilization}
                  color={t.blue}
                  label="Session"
                  sub={limits.five_hour.resets_at ? `resets in ${fmtResetsAt(limits.five_hour.resets_at)}` : "—"}
                  t={t}
                />
                <Ring
                  pct={limits.seven_day.utilization}
                  color={t.green}
                  label="Weekly"
                  sub={limits.seven_day.resets_at ? `resets in ${fmtResetsAt(limits.seven_day.resets_at)}` : "—"}
                  t={t}
                />
                {limits.extra_usage && (
                  <Ring
                    pct={limits.extra_usage.utilization}
                    color={t.purple}
                    label="Extra"
                    sub={`$${limits.extra_usage.used_credits.toFixed(0)}/$${limits.extra_usage.monthly_limit}`}
                    t={t}
                  />
                )}
              </div>
            </div>
          )}
        </section>

        {/* Claude Sessions */}
        <section>
          <SectionLabel icon="◆" title="Claude Sessions" sub="via ccusage · click to open" />
          {sessionsLoading ? (
            <div style={{ color: t.label3, fontSize: 12, padding: "8px 0" }}>Loading sessions…</div>
          ) : mergedSessions.length === 0 ? (
            <div style={{ color: t.label3, fontSize: 12, padding: "8px 0", lineHeight: 1.6 }}>
              No session data found.<br />
              <span style={{ color: t.label3, fontSize: 11 }}>
                Requires: <code style={{ color: t.orange }}>npm install -g ccusage</code>
              </span>
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
                        background: t.surface3,
                        border: `1px solid ${t.borderSubtle}`,
                        cursor: canOpen ? "pointer" : "default",
                        transition: "background 0.15s",
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

        {/* GitHub Repos */}
        <section>
          <SectionLabel icon="◆" title="GitHub Repos" />
          {data ? (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <StatCard label="Top Repo" value={topRepo} sub={data.repos[0] ? `${data.repos[0].visits} visits` : undefined} accent={t.green} t={t} />
                <StatCard label="Repos Tracked" value={data.repos.length} sub="unique repos visited" accent={t.orange} t={t} />
              </div>
              <div style={card}>
                <div style={{ fontSize: 11, color: t.label3, marginBottom: 10, fontFamily: "monospace" }}>visits since first launch · ~/Documents/GitHub/</div>
                {data.repos.length > 0 ? <RepoChart repos={data.repos} t={t} /> : (
                  <div style={{ color: t.label3, fontSize: 12, padding: "8px 0" }}>No repo visits tracked yet.</div>
                )}
              </div>
            </>
          ) : (
            <div style={{ color: t.label3, fontSize: 12, padding: "8px 0" }}>Loading…</div>
          )}
        </section>
      </div>
    </div>
  );
}
