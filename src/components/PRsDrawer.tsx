import { useState, useEffect } from "react";
import { useTheme } from "../ThemeContext";

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
  onOpenRepo: (repoName: string, branchName: string) => void;
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

function ReviewPill({ decision }: { decision: string | null }) {
  const { theme: t } = useTheme();
  type Cfg = { label: string; color: string; bg: string };
  const configs: Record<string, Cfg> = {
    APPROVED:          { label: "Approved",          color: t.green,  bg: `${t.green}18` },
    CHANGES_REQUESTED: { label: "Changes requested", color: t.red,    bg: `${t.red}15` },
    REVIEW_REQUIRED:   { label: "Review pending",    color: t.orange, bg: `${t.orange}15` },
  };
  const cfg = configs[decision ?? "REVIEW_REQUIRED"] ?? configs.REVIEW_REQUIRED;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, fontWeight: 600,
      color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.color}30`,
      borderRadius: 20, padding: "2px 8px",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.color, flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { theme: t } = useTheme();
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={copy} title={`Copy ${label}`} style={{
      background: "none", border: "none", cursor: "pointer",
      color: copied ? t.teal : t.label4,
      fontSize: 13, padding: "1px 3px", borderRadius: 3,
      lineHeight: 1, transition: "color 0.15s", flexShrink: 0,
    }}
      onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = t.label2; }}
      onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = t.label4; }}
    >
      {copied ? "✓" : "⎘"}
    </button>
  );
}

function PRCard({ pr, onOpenTerminal }: { pr: PR; onOpenTerminal: (repo: string, branch: string) => void }) {
  const { theme: t } = useTheme();
  const [hovered, setHovered] = useState(false);
  const shortSha = pr.headRefOid.slice(0, 7);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        margin: "0 12px 8px", padding: "13px 14px",
        background: hovered ? t.surface3 : t.surface2,
        border: `1px solid ${hovered ? t.borderMid : t.borderSubtle}`,
        borderRadius: 12,
        boxShadow: hovered ? "0 4px 16px rgba(0,0,0,0.12)" : "none",
        transition: "all 0.18s",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <span style={{
          fontSize: 12, fontWeight: 700, color: t.blue,
          background: `${t.blue}15`, border: `1px solid ${t.blue}30`,
          borderRadius: 5, padding: "2px 6px",
          flexShrink: 0, marginTop: 1, fontFamily: "monospace",
        }}>
          #{pr.number}
        </span>
        <span style={{ color: t.label1, fontSize: 12, fontWeight: 500, lineHeight: 1.5, flex: 1 }}>
          {pr.title}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {pr.isDraft && (
          <span style={{
            fontSize: 11, fontWeight: 600, color: t.label3,
            background: t.surface3, border: `1px solid ${t.borderMid}`,
            borderRadius: 20, padding: "2px 8px",
          }}>Draft</span>
        )}
        <ReviewPill decision={pr.reviewDecision} />
        <span style={{ fontSize: 11, color: t.green, marginLeft: "auto", fontFamily: "monospace" }}>
          {timeAgo(pr.createdAt)}
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          background: `${t.blue}10`, border: `1px solid ${t.blue}28`,
          borderRadius: 7, padding: "4px 8px", flex: 1, minWidth: 0,
        }}>
          <span style={{ color: t.blue, fontSize: 12, flexShrink: 0 }}>⎇</span>
          <span style={{ fontSize: 12, color: t.blue, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pr.headRefName}
          </span>
          <CopyButton text={pr.headRefName} label="branch" />
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          background: `${t.orange}10`, border: `1px solid ${t.orange}28`,
          borderRadius: 7, padding: "4px 8px", flexShrink: 0,
        }}>
          <span style={{ color: t.orange, fontSize: 12 }}>◉</span>
          <span style={{ fontSize: 12, color: t.orange, fontFamily: "monospace" }}>{shortSha}</span>
          <CopyButton text={pr.headRefOid} label="commit SHA" />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => window.terminal.openExternal(pr.url)}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            background: `${t.blue}12`, border: `1px solid ${t.blue}30`,
            borderRadius: 8, color: t.blue,
            cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "7px 10px",
            transition: "all 0.18s",
          }}
          onMouseEnter={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = `${t.blue}25`; b.style.borderColor = `${t.blue}60`; }}
          onMouseLeave={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = `${t.blue}12`; b.style.borderColor = `${t.blue}30`; }}
        >
          <span style={{ fontSize: 12 }}>↗</span> Open PR
        </button>
        <button
          onClick={() => onOpenTerminal(pr.repository.name, pr.headRefName)}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            background: `${t.teal}10`, border: `1px solid ${t.teal}28`,
            borderRadius: 8, color: t.teal,
            cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "7px 10px",
            transition: "all 0.18s",
          }}
          onMouseEnter={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = `${t.teal}22`; b.style.borderColor = `${t.teal}55`; }}
          onMouseLeave={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.background = `${t.teal}10`; b.style.borderColor = `${t.teal}28`; }}
        >
          <span style={{ fontSize: 12 }}>⌨</span> Open Terminal
        </button>
      </div>
    </div>
  );
}

interface LocalBranch { repo: string; branch: string; repoUrl: string }

function LocalBranchCard({
  item, selected, onToggle, onOpenTerminal, repoUrl,
}: { item: LocalBranch; selected: boolean; onToggle: () => void; onOpenTerminal: (repo: string, branch: string) => void; repoUrl: string }) {
  const { theme: t } = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        margin: "0 12px 5px", padding: "8px 12px",
        background: selected ? `${t.blue}12` : hovered ? t.surface3 : t.surface2,
        border: `1px solid ${selected ? `${t.blue}35` : hovered ? t.borderMid : t.borderSubtle}`,
        borderRadius: 8, display: "flex", alignItems: "center", gap: 8,
        transition: "all 0.15s", cursor: "default",
      }}
    >
      <div
        onClick={onToggle}
        style={{
          width: 14, height: 14, borderRadius: 3, flexShrink: 0, cursor: "pointer",
          border: `1px solid ${selected ? t.blue : t.borderMid}`,
          background: selected ? t.blue : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s",
        }}
      >
        {selected && <span style={{ color: "#fff", fontSize: 9, lineHeight: 1, fontWeight: 700 }}>✓</span>}
      </div>
      <span style={{
        flex: 1, fontSize: 10, color: t.label3, fontFamily: "monospace",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        display: "flex", alignItems: "center", gap: 5,
      }}>
        <span style={{ color: t.label4 }}>⎇</span>
        {item.branch}
      </span>
      <div style={{
        display: "flex", alignItems: "stretch",
        background: `${t.teal}10`, border: `1px solid ${t.teal}28`,
        borderRadius: 5, overflow: "hidden", flexShrink: 0,
      }}>
        <button
          onClick={() => repoUrl && window.terminal.openExternal(`${repoUrl}/tree/${item.branch}`)}
          title="View in GitHub"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: t.teal, fontSize: 11, padding: "2px 5px",
            display: "flex", alignItems: "center",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = `${t.teal}20`)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >↗</button>
        <div style={{ width: 1, background: `${t.teal}28`, flexShrink: 0 }} />
        <button
          onClick={() => onOpenTerminal(item.repo, item.branch)}
          title="Open terminal"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: t.teal, fontSize: 11, padding: "2px 5px",
            display: "flex", alignItems: "center",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = `${t.teal}20`)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >⌨</button>
      </div>
    </div>
  );
}

interface RepoEntry { name: string; branches: string[]; repoUrl: string }

export function PRsDrawer({ onClose, onOpenTerminal, onOpenRepo }: Props) {
  const { theme: t } = useTheme();
  const [prs, setPRs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localBranches, setLocalBranches] = useState<LocalBranch[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [showLocal, setShowLocal] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [showRepos, setShowRepos] = useState(true);
  const [pinnedRepos, setPinnedRepos] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("td_pinned_repos") ?? "[]")); }
    catch { return new Set(); }
  });

  const togglePin = (name: string) => {
    setPinnedRepos((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      localStorage.setItem("td_pinned_repos", JSON.stringify([...next]));
      return next;
    });
  };

  const sortedRepos = [...repos].sort((a, b) => {
    const ap = pinnedRepos.has(a.name) ? 0 : 1;
    const bp = pinnedRepos.has(b.name) ? 0 : 1;
    return ap !== bp ? ap - bp : a.name.localeCompare(b.name);
  });

  const load = () => {
    setLoading(true); setLocalLoading(true); setError(null); setSelected(new Set());
    window.terminal.listPRs()
      .then((data) => { setPRs(data); setLoading(false); })
      .catch((err: Error) => { setError(err.message ?? "Failed to load PRs"); setLoading(false); });
    window.terminal.listLocalBranches()
      .then((data) => { setLocalBranches(data); setLocalLoading(false); })
      .catch(() => setLocalLoading(false));
    window.terminal.listGithubRepos()
      .then(setRepos)
      .catch(() => {});
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

  return (
    <div style={{
      width: 400, flexShrink: 0,
      background: t.surface1,
      borderLeft: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column",
      boxShadow: t.isDark ? "-4px 0 36px rgba(0,0,0,0.6)" : "-4px 0 20px rgba(0,0,0,0.08)",
      overflowY: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", padding: "15px 16px",
        borderBottom: `1px solid ${t.border}`,
        flexShrink: 0, background: t.headerBg,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: t.label1 }}>Pull Requests</div>
          {!loading && (
            <div style={{ color: t.green, fontSize: 11, marginTop: 3, fontFamily: "monospace" }}>
              {prs.length} open PRs · {!localLoading ? `${localOnly.length} local` : "loading…"} · {repos.length} repos
            </div>
          )}
        </div>
        <button onClick={load} title="Refresh"
          style={{ background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 15, padding: "4px 8px", borderRadius: 6, lineHeight: 1, transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
        >↺</button>
        <button onClick={onClose} title="Close"
          style={{ background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 15, padding: "4px 8px", borderRadius: 6, lineHeight: 1, transition: "color 0.15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
        >✕</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 0 20px" }}>
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 10 }}>
            <div style={{ color: t.blue, fontSize: 22 }}>⟳</div>
            <div style={{ color: t.label3, fontSize: 12, fontFamily: "monospace" }}>Fetching pull requests…</div>
          </div>
        )}

        {error && (
          <div style={{ margin: 12, padding: "12px 14px", background: `${t.red}10`, border: `1px solid ${t.red}28`, borderRadius: 10 }}>
            <div style={{ color: t.red, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Failed to load PRs</div>
            <div style={{ color: t.label2, fontSize: 11, fontFamily: "monospace" }}>Make sure <code style={{ color: t.teal }}>gh</code> is installed and authenticated.</div>
          </div>
        )}

        {!loading && !error && prs.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <div style={{ fontSize: 28 }}>🎉</div>
            <div style={{ color: t.label1, fontSize: 13, fontWeight: 600 }}>No open PRs</div>
            <div style={{ color: t.label3, fontSize: 11, fontFamily: "monospace" }}>All caught up!</div>
          </div>
        )}

        {!loading && !error && Object.entries(byRepo).sort((a, b) => b[1].length - a[1].length).map(([repoFullName, repoPRs]) => (
          <div key={repoFullName} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.green, flexShrink: 0 }} />
              <span style={{ color: t.green, fontSize: 13, fontWeight: 600, letterSpacing: 0.3 }}>{repoFullName}</span>
              <span style={{
                color: t.green, fontSize: 10,
                background: `${t.green}15`, border: `1px solid ${t.green}28`,
                borderRadius: 10, padding: "1px 6px", marginLeft: 2, fontFamily: "monospace",
              }}>{repoPRs.length}</span>
            </div>
            {repoPRs.map((pr) => <PRCard key={pr.number} pr={pr} onOpenTerminal={onOpenTerminal} />)}
          </div>
        ))}

        {cleanMsg && (
          <div style={{
            margin: "0 12px 8px", padding: "8px 12px",
            background: cleanMsg.startsWith("Error") ? `${t.red}10` : `${t.green}10`,
            border: `1px solid ${cleanMsg.startsWith("Error") ? t.red : t.green}30`,
            borderRadius: 8,
            color: cleanMsg.startsWith("Error") ? t.red : t.green,
            fontSize: 11, fontFamily: "monospace",
          }}>
            {cleanMsg}
          </div>
        )}

        {repos.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${t.borderMid}, transparent)`, margin: "4px 16px 10px" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px 6px" }}>
              <button
                onClick={() => setShowRepos((v) => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, flex: 1,
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                  color: t.blue, fontSize: 13, fontWeight: 600, letterSpacing: 0.3,
                  textAlign: "left",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.blue, flexShrink: 0 }} />
                Repos
                <span style={{
                  color: t.blue, fontSize: 10,
                  background: `${t.blue}15`, border: `1px solid ${t.blue}28`,
                  borderRadius: 10, padding: "1px 6px", fontFamily: "monospace",
                }}>{repos.length}</span>
                <span style={{ fontSize: 10, color: t.label4 }}>{showRepos ? "▾" : "▸"}</span>
              </button>
            </div>
            {showRepos && sortedRepos.map((repo) => {
              const pinned = pinnedRepos.has(repo.name);
              return (
                <div key={repo.name} style={{
                  margin: "0 12px 5px", padding: "8px 12px",
                  background: pinned ? `${t.orange}08` : t.surface2,
                  border: `1px solid ${pinned ? `${t.orange}28` : t.borderSubtle}`,
                  borderRadius: 8, display: "flex", alignItems: "center", gap: 8,
                  transition: "all 0.15s",
                }}>
                  <button
                    onClick={() => togglePin(repo.name)}
                    title={pinned ? "Unpin" : "Pin to top"}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: pinned ? t.orange : t.label4,
                      fontSize: 12, padding: "1px 2px", lineHeight: 1,
                      flexShrink: 0, transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = t.orange)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = pinned ? t.orange : t.label4)}
                  >{pinned ? "★" : "☆"}</button>
                  <span style={{
                    flex: 1, fontSize: 12, color: pinned ? t.label1 : t.label2, fontFamily: "monospace",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontWeight: pinned ? 600 : 400,
                  }}>{repo.name}</span>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {repo.branches.map((branch) => {
                      const c = branch === "main" || branch === "master" ? t.green : t.blue;
                      return (
                        <div key={branch} style={{
                          display: "flex", alignItems: "stretch",
                          background: `${c}12`, border: `1px solid ${c}30`,
                          borderRadius: 5, overflow: "hidden", transition: "all 0.15s",
                        }}>
                          <button
                            onClick={() => repo.repoUrl && window.terminal.openExternal(`${repo.repoUrl}/tree/${branch}`)}
                            title="View in GitHub"
                            style={{
                              background: "none", border: "none", cursor: "pointer",
                              color: c, fontSize: 10, fontWeight: 600,
                              padding: "2px 7px", fontFamily: "monospace",
                              display: "flex", alignItems: "center", gap: 3,
                              transition: "background 0.15s",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = `${c}20`)}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                          >
                            <span style={{ fontSize: 9, opacity: 0.75 }}>↗</span>{branch}
                          </button>
                          <div style={{ width: 1, background: `${c}30`, flexShrink: 0 }} />
                          <button
                            onClick={() => onOpenRepo(repo.name, branch)}
                            title="Open terminal"
                            style={{
                              background: "none", border: "none", cursor: "pointer",
                              color: c, fontSize: 11,
                              padding: "2px 5px",
                              display: "flex", alignItems: "center",
                              transition: "background 0.15s",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = `${c}20`)}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                          >⌨</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!localLoading && !loading && localOnly.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${t.borderMid}, transparent)`, margin: "4px 16px 10px" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px 6px" }}>
              <button
                onClick={() => setShowLocal((v) => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, flex: 1,
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                  color: t.green, fontSize: 13, fontWeight: 600, letterSpacing: 0.3,
                  textAlign: "left",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.green, flexShrink: 0 }} />
                Local branches
                <span style={{
                  color: t.green, fontSize: 10,
                  background: `${t.green}15`, border: `1px solid ${t.green}28`,
                  borderRadius: 10, padding: "1px 6px", fontFamily: "monospace",
                }}>{localOnly.length}</span>
                <span style={{ fontSize: 10, color: t.label4 }}>{showLocal ? "▾" : "▸"}</span>
              </button>

              {selected.size > 0 && (
                <button
                  onClick={handleDeleteSelected} disabled={deleting}
                  style={{
                    background: `${t.red}10`, border: `1px solid ${t.red}30`,
                    borderRadius: 6, color: t.red,
                    cursor: deleting ? "not-allowed" : "pointer",
                    fontSize: 10, fontWeight: 600, padding: "3px 8px",
                    opacity: deleting ? 0.5 : 1,
                  }}
                >🗑 Delete {selected.size}</button>
              )}
            </div>

            {showLocal && Object.entries(localByRepo).sort((a, b) => b[1].length - a[1].length).map(([repo, branches]) => (
              <div key={repo} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 14px 4px 26px" }}>
                  <span style={{ color: t.green, fontSize: 12, fontWeight: 600, flex: 1 }}>{repo}</span>
                  <button
                    onClick={() => handleCleanMerged(repo)} disabled={deleting}
                    title="Delete branches already merged into main"
                    style={{
                      background: "none", border: `1px solid ${t.borderSubtle}`,
                      borderRadius: 5, color: t.label3,
                      cursor: deleting ? "not-allowed" : "pointer",
                      fontSize: 9, fontWeight: 600, padding: "2px 6px",
                      opacity: deleting ? 0.5 : 1, transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${t.teal}50`; e.currentTarget.style.color = t.teal; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.borderSubtle; e.currentTarget.style.color = t.label3; }}
                  >✦ Clean merged</button>
                </div>
                {branches.map((b) => {
                  const key = `${b.repo}::${b.branch}`;
                  return (
                    <LocalBranchCard key={key} item={b} selected={selected.has(key)} onToggle={() => toggleSelect(key)} onOpenTerminal={onOpenTerminal} repoUrl={b.repoUrl} />
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
