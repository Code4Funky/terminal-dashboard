import { useState, useEffect } from "react";

interface PR {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  headRefOid: string;
  isDraft: boolean;
  createdAt: string;
  reviewDecision: string | null;
  repository: { name: string; nameWithOwner: string };
}

interface Props {
  onClose: () => void;
  onOpenTerminal: (repoName: string, branchName: string) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) {
    const hours = Math.floor(diff / 3600000);
    if (hours === 0) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const REVIEW_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  APPROVED:          { label: "Approved",          color: "#34d399", bg: "rgba(52,211,153,0.1)",  dot: "#34d399" },
  CHANGES_REQUESTED: { label: "Changes requested", color: "#f87171", bg: "rgba(248,113,113,0.1)", dot: "#f87171" },
  REVIEW_REQUIRED:   { label: "Review pending",    color: "#fbbf24", bg: "rgba(251,191,36,0.1)",  dot: "#fbbf24" },
};

function ReviewPill({ decision }: { decision: string | null }) {
  const cfg = REVIEW_CONFIG[decision ?? "REVIEW_REQUIRED"] ?? REVIEW_CONFIG.REVIEW_REQUIRED;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
      color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.dot}30`,
      borderRadius: 20, padding: "2px 8px",
      fontFamily: "'Syne', sans-serif",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.dot, boxShadow: `0 0 5px ${cfg.dot}`, flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      onClick={copy}
      title={`Copy ${label}`}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        color: copied ? "#2dd4bf" : "#334155",
        fontSize: 11,
        padding: "1px 3px",
        borderRadius: 3,
        lineHeight: 1,
        transition: "color 0.15s",
        flexShrink: 0,
      }}
    >
      {copied ? "✓" : "⎘"}
    </button>
  );
}

function PRCard({ pr, onOpenTerminal }: { pr: PR; onOpenTerminal: (repo: string, branch: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const shortSha = pr.headRefOid.slice(0, 7);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        margin: "0 12px 8px",
        padding: "13px 14px",
        background: hovered
          ? "rgba(139, 92, 246, 0.1)"
          : "rgba(15, 12, 35, 0.5)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${hovered ? "rgba(139,92,246,0.35)" : "rgba(139,92,246,0.1)"}`,
        borderRadius: 12,
        boxShadow: hovered
          ? "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(167,139,250,0.06)"
          : "0 2px 10px rgba(0,0,0,0.3)",
        transition: "all 0.2s",
      }}
    >
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: "#a78bfa",
          background: "rgba(139, 92, 246, 0.12)",
          border: "1px solid rgba(139, 92, 246, 0.25)",
          borderRadius: 5, padding: "2px 6px",
          flexShrink: 0, marginTop: 1, letterSpacing: 0.3,
          fontFamily: "'DM Mono', monospace",
        }}>
          #{pr.number}
        </span>
        <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 500, lineHeight: 1.5, flex: 1 }}>
          {pr.title}
        </span>
      </div>

      {/* Badges row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {pr.isDraft && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: "#64748b",
            background: "rgba(100, 116, 139, 0.1)",
            border: "1px solid rgba(100,116,139,0.2)",
            borderRadius: 20, padding: "2px 8px",
            fontFamily: "'Syne', sans-serif",
          }}>
            Draft
          </span>
        )}
        <ReviewPill decision={pr.reviewDecision} />
        <span style={{ fontSize: 10, color: "#334155", marginLeft: "auto", fontFamily: "'DM Mono', monospace" }}>
          {timeAgo(pr.createdAt)}
        </span>
      </div>

      {/* Branch + commit row */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "rgba(139, 92, 246, 0.06)",
          border: "1px solid rgba(139, 92, 246, 0.15)",
          borderRadius: 7, padding: "4px 8px", flex: 1, minWidth: 0,
        }}>
          <span style={{ color: "#7c5cbf", fontSize: 10, flexShrink: 0 }}>⎇</span>
          <span style={{
            fontSize: 10, color: "#c4b5fd", fontFamily: "'DM Mono', monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {pr.headRefName}
          </span>
          <CopyButton text={pr.headRefName} label="branch" />
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "rgba(20, 184, 166, 0.06)",
          border: "1px solid rgba(20, 184, 166, 0.15)",
          borderRadius: 7, padding: "4px 8px", flexShrink: 0,
        }}>
          <span style={{ color: "#0d9488", fontSize: 10 }}>◉</span>
          <span style={{ fontSize: 10, color: "#2dd4bf", fontFamily: "'DM Mono', monospace" }}>
            {shortSha}
          </span>
          <CopyButton text={pr.headRefOid} label="commit SHA" />
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => window.terminal.openExternal(pr.url)}
          style={{
            flex: 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            background: "rgba(139, 92, 246, 0.06)",
            border: "1px solid rgba(139, 92, 246, 0.2)",
            borderRadius: 8,
            color: "#a78bfa",
            cursor: "pointer",
            fontSize: 11, fontWeight: 600,
            padding: "7px 10px",
            transition: "all 0.2s",
            fontFamily: "'Syne', sans-serif",
          }}
          onMouseEnter={(e) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = "rgba(139, 92, 246, 0.15)";
            b.style.borderColor = "rgba(167,139,250,0.5)";
            b.style.boxShadow = "0 0 16px rgba(124,58,237,0.2)";
          }}
          onMouseLeave={(e) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = "rgba(139, 92, 246, 0.06)";
            b.style.borderColor = "rgba(139, 92, 246, 0.2)";
            b.style.boxShadow = "none";
          }}
        >
          <span style={{ fontSize: 12 }}>↗</span> Open PR
        </button>
        <button
          onClick={() => onOpenTerminal(pr.repository.name, pr.headRefName)}
          style={{
            flex: 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            background: "rgba(20, 184, 166, 0.06)",
            border: "1px solid rgba(20, 184, 166, 0.2)",
            borderRadius: 8,
            color: "#2dd4bf",
            cursor: "pointer",
            fontSize: 11, fontWeight: 600,
            padding: "7px 10px",
            transition: "all 0.2s",
            fontFamily: "'Syne', sans-serif",
          }}
          onMouseEnter={(e) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = "rgba(20, 184, 166, 0.12)";
            b.style.borderColor = "rgba(45,212,191,0.5)";
            b.style.boxShadow = "0 0 16px rgba(13,148,136,0.2)";
          }}
          onMouseLeave={(e) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = "rgba(20, 184, 166, 0.06)";
            b.style.borderColor = "rgba(20, 184, 166, 0.2)";
            b.style.boxShadow = "none";
          }}
        >
          <span style={{ fontSize: 12 }}>⌨</span> Open Terminal
        </button>
      </div>
    </div>
  );
}

interface LocalBranch { repo: string; branch: string }

function LocalBranchCard({
  item, selected, onToggle, onOpenTerminal,
}: {
  item: LocalBranch;
  selected: boolean;
  onToggle: () => void;
  onOpenTerminal: (repo: string, branch: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        margin: "0 12px 5px",
        padding: "8px 12px",
        background: selected
          ? "rgba(139, 92, 246, 0.12)"
          : hovered
          ? "rgba(139, 92, 246, 0.07)"
          : "rgba(15, 12, 35, 0.4)",
        border: `1px solid ${selected ? "rgba(139,92,246,0.4)" : hovered ? "rgba(139,92,246,0.2)" : "rgba(139,92,246,0.08)"}`,
        borderRadius: 8,
        display: "flex", alignItems: "center", gap: 8,
        transition: "all 0.15s",
        cursor: "default",
      }}
    >
      {/* Checkbox */}
      <div
        onClick={onToggle}
        style={{
          width: 14, height: 14, borderRadius: 3, flexShrink: 0, cursor: "pointer",
          border: `1px solid ${selected ? "rgba(167,139,250,0.7)" : "rgba(139,92,246,0.2)"}`,
          background: selected ? "linear-gradient(135deg, #8b5cf6, #7c3aed)" : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s",
        }}
      >
        {selected && <span style={{ color: "#fff", fontSize: 9, lineHeight: 1 }}>✓</span>}
      </div>

      <span style={{
        flex: 1, fontSize: 10, color: "#c4b5fd", fontFamily: "'DM Mono', monospace",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        display: "flex", alignItems: "center", gap: 5,
      }}>
        <span style={{ color: "#7c5cbf" }}>⎇</span>
        {item.branch}
      </span>

      <button
        onClick={() => onOpenTerminal(item.repo, item.branch)}
        title="Open terminal"
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#334155", fontSize: 12, padding: "2px 4px", borderRadius: 4,
          transition: "color 0.15s", lineHeight: 1,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#2dd4bf")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#334155")}
      >
        ⌨
      </button>
    </div>
  );
}

export function PRsDrawer({ onClose, onOpenTerminal }: Props) {
  const [prs, setPRs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localBranches, setLocalBranches] = useState<LocalBranch[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [showLocal, setShowLocal] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setLocalLoading(true);
    setError(null);
    setSelected(new Set());
    window.terminal.listPRs()
      .then((data) => { setPRs(data); setLoading(false); })
      .catch((err: Error) => { setError(err.message ?? "Failed to load PRs"); setLoading(false); });
    window.terminal.listLocalBranches()
      .then((data) => { setLocalBranches(data); setLocalLoading(false); })
      .catch(() => setLocalLoading(false));
  };

  const reloadLocal = () => {
    setLocalLoading(true);
    setSelected(new Set());
    window.terminal.listLocalBranches()
      .then((data) => { setLocalBranches(data); setLocalLoading(false); })
      .catch(() => setLocalLoading(false));
  };

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (deleting || selected.size === 0) return;
    setDeleting(true);
    const byRepo: Record<string, string[]> = {};
    for (const key of selected) {
      const [repo, branch] = key.split("::");
      if (!byRepo[repo]) byRepo[repo] = [];
      byRepo[repo].push(branch);
    }
    for (const [repo, branches] of Object.entries(byRepo)) {
      await window.terminal.deleteBranches(repo, branches);
    }
    setDeleting(false);
    reloadLocal();
  };

  const handleCleanMerged = async (repo: string) => {
    setDeleting(true);
    try {
      const { deleted, failed } = await window.terminal.cleanupMerged(repo);
      const errReason = failed.find((f) => f.branch === "")?.reason;
      if (errReason) {
        setCleanMsg(`Error: ${errReason}`);
      } else if (deleted.length > 0) {
        setCleanMsg(`Deleted ${deleted.length} branch${deleted.length !== 1 ? "es" : ""}: ${deleted.join(", ")}`);
      } else if (failed.length > 0) {
        setCleanMsg(`Nothing deleted — ${failed.length} failed (may have active worktrees)`);
      } else {
        setCleanMsg("No merged branches found");
      }
      setTimeout(() => setCleanMsg(null), 6000);
    } catch (e: unknown) {
      setCleanMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setCleanMsg(null), 6000);
    }
    setDeleting(false);
    reloadLocal();
  };

  useEffect(() => { load(); }, []);

  const byRepo = prs.reduce<Record<string, PR[]>>((acc, pr) => {
    const key = pr.repository.nameWithOwner;
    if (!acc[key]) acc[key] = [];
    acc[key].push(pr);
    return acc;
  }, {});

  const prBranchKeys = new Set(prs.map((p) => `${p.repository.name}::${p.headRefName}`));
  const localOnly = localBranches.filter((b) => !prBranchKeys.has(`${b.repo}::${b.branch}`));
  const localByRepo = localOnly.reduce<Record<string, LocalBranch[]>>((acc, b) => {
    if (!acc[b.repo]) acc[b.repo] = [];
    acc[b.repo].push(b);
    return acc;
  }, {});

  return (
    <div style={{
      width: 400,
      flexShrink: 0,
      background: "rgba(7, 5, 20, 0.84)",
      backdropFilter: "blur(28px) saturate(160%)",
      WebkitBackdropFilter: "blur(28px) saturate(160%)",
      borderLeft: "1px solid rgba(139, 92, 246, 0.15)",
      display: "flex",
      flexDirection: "column",
      boxShadow: "-4px 0 40px rgba(0,0,0,0.5), -1px 0 0 rgba(139,92,246,0.06)",
      overflowY: "hidden",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center",
        padding: "15px 16px",
        borderBottom: "1px solid rgba(139, 92, 246, 0.1)",
        flexShrink: 0,
        background: "rgba(10, 8, 28, 0.5)",
      }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontWeight: 700, fontSize: 14, letterSpacing: 0.3,
            fontFamily: "'Syne', sans-serif",
            background: "linear-gradient(90deg, #a78bfa, #2dd4bf)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
            Pull Requests
          </div>
          {!loading && (
            <div style={{ color: "#334155", fontSize: 11, marginTop: 3, fontFamily: "'DM Mono', monospace" }}>
              {prs.length} open PRs · {!localLoading ? `${localOnly.length} local` : "loading…"}
            </div>
          )}
        </div>
        <button
          onClick={load}
          title="Refresh"
          style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 15, padding: "4px 8px", borderRadius: 6, lineHeight: 1, transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#a78bfa")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#475569")}
        >↺</button>
        <button
          onClick={onClose}
          title="Close"
          style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 15, padding: "4px 8px", borderRadius: 6, lineHeight: 1, transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#e2e8f0")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#475569")}
        >✕</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 0 20px" }}>
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, gap: 10 }}>
            <div style={{ color: "#8b5cf6", fontSize: 22 }}>⟳</div>
            <div style={{ color: "#334155", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>Fetching pull requests…</div>
          </div>
        )}

        {error && (
          <div style={{
            margin: 12, padding: "12px 14px",
            background: "rgba(248, 113, 113, 0.08)",
            border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10,
          }}>
            <div style={{ color: "#f87171", fontSize: 12, fontWeight: 600, marginBottom: 4, fontFamily: "'Syne', sans-serif" }}>Failed to load PRs</div>
            <div style={{ color: "#94a3b8", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>Make sure <code style={{ color: "#2dd4bf" }}>gh</code> is installed and authenticated.</div>
          </div>
        )}

        {!loading && !error && prs.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <div style={{ fontSize: 28 }}>🎉</div>
            <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, fontFamily: "'Syne', sans-serif" }}>No open PRs</div>
            <div style={{ color: "#334155", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>All caught up!</div>
          </div>
        )}

        {!loading && !error && Object.entries(byRepo).sort((a, b) => b[1].length - a[1].length).map(([repoFullName, repoPRs]) => (
          <div key={repoFullName} style={{ marginBottom: 10 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 16px 8px",
              color: "#64748b", fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
              fontFamily: "'Syne', sans-serif",
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "linear-gradient(135deg, #8b5cf6, #2dd4bf)",
                boxShadow: "0 0 6px rgba(139,92,246,0.6)",
                flexShrink: 0,
              }} />
              <span style={{ color: "#94a3b8" }}>{repoFullName}</span>
              <span style={{
                color: "#475569", fontSize: 10,
                background: "rgba(139, 92, 246, 0.08)",
                border: "1px solid rgba(139,92,246,0.15)",
                borderRadius: 10, padding: "1px 6px", marginLeft: 2,
                fontFamily: "'DM Mono', monospace",
              }}>
                {repoPRs.length}
              </span>
            </div>
            {repoPRs.map((pr) => (
              <PRCard key={pr.number} pr={pr} onOpenTerminal={onOpenTerminal} />
            ))}
          </div>
        ))}

        {/* Clean merged result banner */}
        {cleanMsg && (
          <div style={{
            margin: "0 12px 8px",
            padding: "8px 12px",
            background: cleanMsg.startsWith("Error")
              ? "rgba(248, 113, 113, 0.08)"
              : "rgba(45, 212, 191, 0.08)",
            border: `1px solid ${cleanMsg.startsWith("Error") ? "rgba(248,113,113,0.25)" : "rgba(45,212,191,0.25)"}`,
            borderRadius: 8,
            color: cleanMsg.startsWith("Error") ? "#f87171" : "#2dd4bf",
            fontSize: 11,
            fontFamily: "'DM Mono', monospace",
          }}>
            {cleanMsg}
          </div>
        )}

        {/* Local branches */}
        {!localLoading && !loading && localOnly.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.15), transparent)", margin: "4px 16px 10px" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px 6px" }}>
              <button
                onClick={() => setShowLocal((v) => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, flex: 1,
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                  color: "#64748b", fontSize: 11, fontWeight: 600, letterSpacing: 0.4,
                  textAlign: "left",
                  fontFamily: "'Syne', sans-serif",
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "linear-gradient(135deg, #a78bfa, #2dd4bf)",
                  boxShadow: "0 0 6px rgba(167,139,250,0.5)", flexShrink: 0,
                }} />
                Local branches
                <span style={{
                  color: "#475569", fontSize: 10,
                  background: "rgba(139, 92, 246, 0.08)",
                  border: "1px solid rgba(139,92,246,0.15)",
                  borderRadius: 10, padding: "1px 6px",
                  fontFamily: "'DM Mono', monospace",
                }}>
                  {localOnly.length}
                </span>
                <span style={{ fontSize: 10, color: "#334155" }}>{showLocal ? "▾" : "▸"}</span>
              </button>

              {selected.size > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  disabled={deleting}
                  style={{
                    background: "rgba(248, 113, 113, 0.08)",
                    border: "1px solid rgba(248,113,113,0.25)",
                    borderRadius: 6, color: "#f87171",
                    cursor: deleting ? "not-allowed" : "pointer",
                    fontSize: 10, fontWeight: 600, padding: "3px 8px",
                    opacity: deleting ? 0.5 : 1,
                    fontFamily: "'Syne', sans-serif",
                    transition: "all 0.15s",
                  }}
                >
                  🗑 Delete {selected.size}
                </button>
              )}
            </div>

            {showLocal && Object.entries(localByRepo).sort((a, b) => b[1].length - a[1].length).map(([repo, branches]) => (
              <div key={repo} style={{ marginBottom: 8 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "4px 14px 4px 26px",
                }}>
                  <span style={{ color: "#334155", fontSize: 10, fontWeight: 600, flex: 1, fontFamily: "'Syne', sans-serif" }}>{repo}</span>
                  <button
                    onClick={() => handleCleanMerged(repo)}
                    disabled={deleting}
                    title="Delete branches already merged into main"
                    style={{
                      background: "none",
                      border: "1px solid rgba(139, 92, 246, 0.15)",
                      borderRadius: 5, color: "#475569",
                      cursor: deleting ? "not-allowed" : "pointer",
                      fontSize: 9, fontWeight: 600, padding: "2px 6px",
                      opacity: deleting ? 0.5 : 1, transition: "all 0.15s",
                      fontFamily: "'Syne', sans-serif",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.4)"; e.currentTarget.style.color = "#a78bfa"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.15)"; e.currentTarget.style.color = "#475569"; }}
                  >
                    ✦ Clean merged
                  </button>
                </div>

                {branches.map((b) => {
                  const key = `${b.repo}::${b.branch}`;
                  return (
                    <LocalBranchCard
                      key={key}
                      item={b}
                      selected={selected.has(key)}
                      onToggle={() => toggleSelect(key)}
                      onOpenTerminal={onOpenTerminal}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
