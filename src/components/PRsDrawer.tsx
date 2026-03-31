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
      border: `1px solid ${cfg.dot}28`,
      borderRadius: 20, padding: "2px 8px",
      fontFamily: "'Syne', sans-serif",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.dot, flexShrink: 0 }} />
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
        background: "none", border: "none", cursor: "pointer",
        color: copied ? "#00f080" : "rgba(0,210,120,0.28)",
        fontSize: 11, padding: "1px 3px", borderRadius: 3,
        lineHeight: 1, transition: "color 0.15s", flexShrink: 0,
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
        background: hovered ? "rgba(0, 255, 135, 0.09)" : "rgba(0, 255, 135, 0.05)",
        border: `1px solid ${hovered ? "rgba(0,255,135,0.25)" : "rgba(0,255,135,0.12)"}`,
        borderRadius: 12,
        boxShadow: hovered ? "0 4px 20px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.2)",
        transition: "all 0.18s",
      }}
    >
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: "#00f080",
          background: "rgba(0, 255, 135, 0.08)",
          border: "1px solid rgba(0, 255, 135, 0.2)",
          borderRadius: 5, padding: "2px 6px",
          flexShrink: 0, marginTop: 1, letterSpacing: 0.3,
          fontFamily: "'DM Mono', monospace",
        }}>
          #{pr.number}
        </span>
        <span style={{ color: "#e2fff3", fontSize: 12, fontWeight: 500, lineHeight: 1.5, flex: 1 }}>
          {pr.title}
        </span>
      </div>

      {/* Badges row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {pr.isDraft && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: "rgba(0,240,128,0.45)",
            background: "rgba(0,255,135,0.05)",
            border: "1px solid rgba(0,255,135,0.12)",
            borderRadius: 20, padding: "2px 8px",
            fontFamily: "'Syne', sans-serif",
          }}>
            Draft
          </span>
        )}
        <ReviewPill decision={pr.reviewDecision} />
        <span style={{ fontSize: 10, color: "rgba(0,210,120,0.28)", marginLeft: "auto", fontFamily: "'DM Mono', monospace" }}>
          {timeAgo(pr.createdAt)}
        </span>
      </div>

      {/* Branch + commit row */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
        {/* Branch chip — blue */}
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "rgba(96, 165, 250, 0.07)",
          border: "1px solid rgba(96, 165, 250, 0.2)",
          borderRadius: 7, padding: "4px 8px", flex: 1, minWidth: 0,
        }}>
          <span style={{ color: "#60a5fa", fontSize: 10, flexShrink: 0 }}>⎇</span>
          <span style={{
            fontSize: 10, color: "#bfdbfe", fontFamily: "'DM Mono', monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {pr.headRefName}
          </span>
          <CopyButton text={pr.headRefName} label="branch" />
        </div>

        {/* Commit chip — amber */}
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "rgba(251, 191, 36, 0.07)",
          border: "1px solid rgba(251, 191, 36, 0.2)",
          borderRadius: 7, padding: "4px 8px", flexShrink: 0,
        }}>
          <span style={{ color: "#fbbf24", fontSize: 10 }}>◉</span>
          <span style={{ fontSize: 10, color: "#fde68a", fontFamily: "'DM Mono', monospace" }}>
            {shortSha}
          </span>
          <CopyButton text={pr.headRefOid} label="commit SHA" />
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        {/* Open PR — blue */}
        <button
          onClick={() => window.terminal.openExternal(pr.url)}
          style={{
            flex: 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            background: "rgba(96, 165, 250, 0.08)",
            border: "1px solid rgba(96, 165, 250, 0.22)",
            borderRadius: 8, color: "#93c5fd",
            cursor: "pointer", fontSize: 11, fontWeight: 600,
            padding: "7px 10px", transition: "all 0.18s",
            fontFamily: "'Syne', sans-serif",
          }}
          onMouseEnter={(e) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = "rgba(96, 165, 250, 0.15)";
            b.style.borderColor = "rgba(96, 165, 250, 0.45)";
            b.style.color = "#60a5fa";
          }}
          onMouseLeave={(e) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = "rgba(96, 165, 250, 0.08)";
            b.style.borderColor = "rgba(96, 165, 250, 0.22)";
            b.style.color = "#93c5fd";
          }}
        >
          <span style={{ fontSize: 12 }}>↗</span> Open PR
        </button>
        {/* Open Terminal — cyan */}
        <button
          onClick={() => onOpenTerminal(pr.repository.name, pr.headRefName)}
          style={{
            flex: 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            background: "rgba(34, 211, 238, 0.07)",
            border: "1px solid rgba(34, 211, 238, 0.2)",
            borderRadius: 8, color: "#67e8f9",
            cursor: "pointer", fontSize: 11, fontWeight: 600,
            padding: "7px 10px", transition: "all 0.18s",
            fontFamily: "'Syne', sans-serif",
          }}
          onMouseEnter={(e) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = "rgba(34, 211, 238, 0.13)";
            b.style.borderColor = "rgba(34, 211, 238, 0.42)";
            b.style.color = "#22d3ee";
          }}
          onMouseLeave={(e) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = "rgba(34, 211, 238, 0.07)";
            b.style.borderColor = "rgba(34, 211, 238, 0.2)";
            b.style.color = "#67e8f9";
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
          ? "rgba(0, 255, 135, 0.1)"
          : hovered
          ? "rgba(0, 255, 135, 0.07)"
          : "rgba(0, 255, 135, 0.04)",
        border: `1px solid ${selected ? "rgba(0,255,135,0.3)" : hovered ? "rgba(0,255,135,0.18)" : "rgba(0,255,135,0.1)"}`,
        borderRadius: 8,
        display: "flex", alignItems: "center", gap: 8,
        transition: "all 0.15s", cursor: "default",
      }}
    >
      <div
        onClick={onToggle}
        style={{
          width: 14, height: 14, borderRadius: 3, flexShrink: 0, cursor: "pointer",
          border: `1px solid ${selected ? "rgba(0,255,135,0.6)" : "rgba(0,255,135,0.2)"}`,
          background: selected ? "#00f080" : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s",
        }}
      >
        {selected && <span style={{ color: "#071a0e", fontSize: 9, lineHeight: 1, fontWeight: 700 }}>✓</span>}
      </div>

      <span style={{
        flex: 1, fontSize: 10, color: "#d4ffee", fontFamily: "'DM Mono', monospace",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        display: "flex", alignItems: "center", gap: 5,
      }}>
        <span style={{ color: "rgba(0,240,128,0.45)" }}>⎇</span>
        {item.branch}
      </span>

      <button
        onClick={() => onOpenTerminal(item.repo, item.branch)}
        title="Open terminal"
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "rgba(0,210,120,0.28)", fontSize: 12, padding: "2px 4px",
          borderRadius: 4, transition: "color 0.15s", lineHeight: 1,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#22d3ee")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(0,210,120,0.28)")}
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
    setLoading(true); setLocalLoading(true); setError(null); setSelected(new Set());
    window.terminal.listPRs()
      .then((data) => { setPRs(data); setLoading(false); })
      .catch((err: Error) => { setError(err.message ?? "Failed to load PRs"); setLoading(false); });
    window.terminal.listLocalBranches()
      .then((data) => { setLocalBranches(data); setLocalLoading(false); })
      .catch(() => setLocalLoading(false));
  };

  const reloadLocal = () => {
    setLocalLoading(true); setSelected(new Set());
    window.terminal.listLocalBranches()
      .then((data) => { setLocalBranches(data); setLocalLoading(false); })
      .catch(() => setLocalLoading(false));
  };

  const toggleSelect = (key: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
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
    setDeleting(false); reloadLocal();
  };

  const handleCleanMerged = async (repo: string) => {
    setDeleting(true);
    try {
      const { deleted, failed } = await window.terminal.cleanupMerged(repo);
      const errReason = failed.find((f) => f.branch === "")?.reason;
      if (errReason) setCleanMsg(`Error: ${errReason}`);
      else if (deleted.length > 0) setCleanMsg(`Deleted ${deleted.length} branch${deleted.length !== 1 ? "es" : ""}: ${deleted.join(", ")}`);
      else if (failed.length > 0) setCleanMsg(`Nothing deleted — ${failed.length} failed (may have active worktrees)`);
      else setCleanMsg("No merged branches found");
      setTimeout(() => setCleanMsg(null), 6000);
    } catch (e: unknown) {
      setCleanMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setTimeout(() => setCleanMsg(null), 6000);
    }
    setDeleting(false); reloadLocal();
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

  const glassBase: React.CSSProperties = {
    width: 400, flexShrink: 0,
    background: "rgba(10, 26, 15, 0.84)",
    backdropFilter: "blur(28px) saturate(150%)",
    WebkitBackdropFilter: "blur(28px) saturate(150%)",
    borderLeft: "1px solid rgba(0, 255, 135, 0.12)",
    display: "flex", flexDirection: "column",
    boxShadow: "-4px 0 36px rgba(0,0,0,0.4)",
    overflowY: "hidden",
  };

  return (
    <div style={glassBase}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center",
        padding: "15px 16px",
        borderBottom: "1px solid rgba(0, 255, 135, 0.1)",
        flexShrink: 0,
        background: "rgba(8, 20, 12, 0.5)",
      }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontWeight: 700, fontSize: 14, letterSpacing: 0.3,
            fontFamily: "'Syne', sans-serif",
            color: "#00f080",
          }}>
            Pull Requests
          </div>
          {!loading && (
            <div style={{ color: "rgba(0,210,120,0.28)", fontSize: 11, marginTop: 3, fontFamily: "'DM Mono', monospace" }}>
              {prs.length} open PRs · {!localLoading ? `${localOnly.length} local` : "loading…"}
            </div>
          )}
        </div>
        <button onClick={load} title="Refresh"
          style={{ background: "none", border: "none", color: "rgba(0,210,120,0.28)", cursor: "pointer", fontSize: 15, padding: "4px 8px", borderRadius: 6, lineHeight: 1, transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#00f080")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(0,210,120,0.28)")}
        >↺</button>
        <button onClick={onClose} title="Close"
          style={{ background: "none", border: "none", color: "rgba(0,210,120,0.28)", cursor: "pointer", fontSize: 15, padding: "4px 8px", borderRadius: 6, lineHeight: 1, transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#e2fff3")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(0,210,120,0.28)")}
        >✕</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 0 20px" }}>
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 10 }}>
            <div style={{ color: "#00f080", fontSize: 22 }}>⟳</div>
            <div style={{ color: "rgba(0,210,120,0.28)", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>Fetching pull requests…</div>
          </div>
        )}

        {error && (
          <div style={{
            margin: 12, padding: "12px 14px",
            background: "rgba(248, 113, 113, 0.07)",
            border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10,
          }}>
            <div style={{ color: "#f87171", fontSize: 12, fontWeight: 600, marginBottom: 4, fontFamily: "'Syne', sans-serif" }}>Failed to load PRs</div>
            <div style={{ color: "rgba(0,240,128,0.45)", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>Make sure <code style={{ color: "#00f080" }}>gh</code> is installed and authenticated.</div>
          </div>
        )}

        {!loading && !error && prs.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <div style={{ fontSize: 28 }}>🎉</div>
            <div style={{ color: "#e2fff3", fontSize: 13, fontWeight: 600, fontFamily: "'Syne', sans-serif" }}>No open PRs</div>
            <div style={{ color: "rgba(0,210,120,0.28)", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>All caught up!</div>
          </div>
        )}

        {!loading && !error && Object.entries(byRepo).sort((a, b) => b[1].length - a[1].length).map(([repoFullName, repoPRs]) => (
          <div key={repoFullName} style={{ marginBottom: 10 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 16px",
              fontFamily: "'Syne', sans-serif",
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#00f080",
                flexShrink: 0,
              }} />
              <span style={{ color: "rgba(0,240,128,0.45)", fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>{repoFullName}</span>
              <span style={{
                color: "rgba(0,210,120,0.28)", fontSize: 10,
                background: "rgba(0,255,135,0.06)",
                border: "1px solid rgba(0,255,135,0.12)",
                borderRadius: 10, padding: "1px 6px", marginLeft: 2,
                fontFamily: "'DM Mono', monospace",
              }}>
                {repoPRs.length}
              </span>
            </div>
            {repoPRs.map((pr) => <PRCard key={pr.number} pr={pr} onOpenTerminal={onOpenTerminal} />)}
          </div>
        ))}

        {cleanMsg && (
          <div style={{
            margin: "0 12px 8px", padding: "8px 12px",
            background: cleanMsg.startsWith("Error") ? "rgba(248,113,113,0.07)" : "rgba(0,255,135,0.07)",
            border: `1px solid ${cleanMsg.startsWith("Error") ? "rgba(248,113,113,0.22)" : "rgba(0,255,135,0.2)"}`,
            borderRadius: 8,
            color: cleanMsg.startsWith("Error") ? "#f87171" : "#00f080",
            fontSize: 11, fontFamily: "'DM Mono', monospace",
          }}>
            {cleanMsg}
          </div>
        )}

        {!localLoading && !loading && localOnly.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(0,255,135,0.12), transparent)", margin: "4px 16px 10px" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px 6px" }}>
              <button
                onClick={() => setShowLocal((v) => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, flex: 1,
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                  color: "rgba(0,240,128,0.45)", fontSize: 11, fontWeight: 600, letterSpacing: 0.4,
                  textAlign: "left", fontFamily: "'Syne', sans-serif",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00f080", flexShrink: 0 }} />
                Local branches
                <span style={{
                  color: "rgba(0,210,120,0.28)", fontSize: 10,
                  background: "rgba(0,255,135,0.06)",
                  border: "1px solid rgba(0,255,135,0.12)",
                  borderRadius: 10, padding: "1px 6px",
                  fontFamily: "'DM Mono', monospace",
                }}>
                  {localOnly.length}
                </span>
                <span style={{ fontSize: 10, color: "rgba(0,210,120,0.28)" }}>{showLocal ? "▾" : "▸"}</span>
              </button>

              {selected.size > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  disabled={deleting}
                  style={{
                    background: "rgba(248,113,113,0.07)",
                    border: "1px solid rgba(248,113,113,0.22)",
                    borderRadius: 6, color: "#f87171",
                    cursor: deleting ? "not-allowed" : "pointer",
                    fontSize: 10, fontWeight: 600, padding: "3px 8px",
                    opacity: deleting ? 0.5 : 1,
                    fontFamily: "'Syne', sans-serif",
                  }}
                >
                  🗑 Delete {selected.size}
                </button>
              )}
            </div>

            {showLocal && Object.entries(localByRepo).sort((a, b) => b[1].length - a[1].length).map(([repo, branches]) => (
              <div key={repo} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 14px 4px 26px" }}>
                  <span style={{ color: "rgba(0,210,120,0.28)", fontSize: 10, fontWeight: 600, flex: 1, fontFamily: "'Syne', sans-serif" }}>{repo}</span>
                  <button
                    onClick={() => handleCleanMerged(repo)}
                    disabled={deleting}
                    title="Delete branches already merged into main"
                    style={{
                      background: "none",
                      border: "1px solid rgba(0, 255, 135, 0.12)",
                      borderRadius: 5, color: "rgba(0,240,128,0.45)",
                      cursor: deleting ? "not-allowed" : "pointer",
                      fontSize: 9, fontWeight: 600, padding: "2px 6px",
                      opacity: deleting ? 0.5 : 1, transition: "all 0.15s",
                      fontFamily: "'Syne', sans-serif",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,255,135,0.35)"; e.currentTarget.style.color = "#00f080"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(0,255,135,0.12)"; e.currentTarget.style.color = "rgba(0,240,128,0.45)"; }}
                  >
                    ✦ Clean merged
                  </button>
                </div>

                {branches.map((b) => {
                  const key = `${b.repo}::${b.branch}`;
                  return (
                    <LocalBranchCard
                      key={key} item={b}
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
