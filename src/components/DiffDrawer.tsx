import { useState, useEffect, useRef } from "react";
import { useTheme } from "../ThemeContext";
import { SYS_FONT } from "../theme";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DiffLine { type: "add" | "del" | "ctx"; content: string; }
interface DiffChunk { header: string; lines: DiffLine[]; }
interface DiffFile { path: string; additions: number; deletions: number; chunks: DiffChunk[]; status: "A" | "D" | "M"; }

interface WTFile {
  path: string; filename: string; dir: string;
  status: string; additions: number; deletions: number;
}

interface CommitEntry { hash: string; subject: string; author: string; date: string; isMerge: boolean; additions: number; deletions: number; }

// ── ANSI escape code stripper ─────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

// ── Hunk header parser ────────────────────────────────────────────────────────

function parseHunkHeader(header: string): { oldStart: number; newStart: number } {
  const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return m ? { oldStart: parseInt(m[1]), newStart: parseInt(m[2]) } : { oldStart: 1, newStart: 1 };
}

// ── Diff parser ───────────────────────────────────────────────────────────────

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const sections = raw.split(/^diff --git /m).filter(Boolean);
  for (const section of sections) {
    const lines = section.split("\n");
    const pathMatch = lines[0].match(/b\/(.+)$/);
    if (!pathMatch) continue;
    const path = pathMatch[1].trim();
    const chunks: DiffChunk[] = [];
    let currentChunk: DiffChunk | null = null;
    let additions = 0, deletions = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("@@")) {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = { header: line, lines: [] };
      } else if (currentChunk) {
        if (line.startsWith("+") && !line.startsWith("+++")) { currentChunk.lines.push({ type: "add", content: stripAnsi(line.slice(1)) }); additions++; }
        else if (line.startsWith("-") && !line.startsWith("---")) { currentChunk.lines.push({ type: "del", content: stripAnsi(line.slice(1)) }); deletions++; }
        else if (line.startsWith(" ")) currentChunk.lines.push({ type: "ctx", content: stripAnsi(line.slice(1)) });
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    if (chunks.length > 0) {
      const status: "A" | "D" | "M" = additions === 0 ? "D" : deletions === 0 ? "A" : "M";
      files.push({ path, additions, deletions, chunks, status });
    }
  }
  return files;
}

// ── Shared diff renderer ──────────────────────────────────────────────────────

function DiffChunks({ files, t }: { files: DiffFile[]; t: ReturnType<typeof useTheme>["theme"] }) {
  return (
    <>
      {files.map((file, fi) => (
        <div key={fi}>
          {file.chunks.map((chunk, ci) => {
            const { oldStart, newStart } = parseHunkHeader(chunk.header);
            let oldLine = oldStart, newLine = newStart;
            return (
              <div key={ci}>
                <div style={{
                  padding: "2px 8px",
                  background: t.isDark ? "rgba(56,139,253,0.08)" : "rgba(0,100,200,0.06)",
                  color: t.blue, fontSize: 12, fontFamily: "monospace",
                  borderTop: `1px solid ${t.border}`,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{chunk.header}</div>
                {chunk.lines.map((line, li) => {
                  const oln = line.type !== "add" ? oldLine : null;
                  const nln = line.type !== "del" ? newLine : null;
                  if (line.type !== "add") oldLine++;
                  if (line.type !== "del") newLine++;
                  return (
                    <div key={li} style={{
                      display: "flex",
                      background: line.type === "add" ? (t.isDark ? "#0d2818" : "#eaffee") : line.type === "del" ? (t.isDark ? "#2d1117" : "#fff0f0") : "transparent",
                      borderLeft: `2px solid ${line.type === "add" ? t.green : line.type === "del" ? t.red : "transparent"}`,
                    }}>
                      {/* Old line number */}
                      <span style={{
                        width: 38, flexShrink: 0, textAlign: "right" as const,
                        color: t.label4, fontSize: 12, fontFamily: "monospace",
                        padding: "0 4px 0 0", userSelect: "none",
                        borderRight: `1px solid ${t.borderSubtle}`,
                      }}>{oln ?? ""}</span>
                      {/* New line number */}
                      <span style={{
                        width: 38, flexShrink: 0, textAlign: "right" as const,
                        color: t.label4, fontSize: 12, fontFamily: "monospace",
                        padding: "0 6px 0 0", userSelect: "none",
                        borderRight: `1px solid ${t.borderSubtle}`, marginRight: 4,
                      }}>{nln ?? ""}</span>
                      {/* +/- gutter */}
                      <span style={{ color: line.type === "add" ? t.green : line.type === "del" ? t.red : t.label4, fontSize: 13, fontFamily: "monospace", padding: "0 4px", flexShrink: 0, userSelect: "none" }}>
                        {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                      </span>
                      <span style={{
                        color: line.type === "add" ? (t.isDark ? "#aff3c8" : "#24692e") : line.type === "del" ? (t.isDark ? "#ffa198" : "#82071e") : t.label3,
                        fontSize: 13, fontFamily: "monospace",
                        whiteSpace: "pre", paddingRight: 16,
                      }}>{line.content || " "}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

// ── Change bar ────────────────────────────────────────────────────────────────

function ChangeBar({ additions, deletions, t }: { additions: number; deletions: number; t: ReturnType<typeof useTheme>["theme"] }) {
  const total = additions + deletions;
  if (total === 0) return <div style={{ width: 52, flexShrink: 0 }} />;
  return (
    <div style={{
      display: "flex", width: 52, height: 5, borderRadius: 3,
      overflow: "hidden", flexShrink: 0, gap: 1,
      background: t.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    }}>
      {additions > 0 && <div style={{ flex: additions, background: t.green, borderRadius: "3px 0 0 3px" }} />}
      {deletions > 0 && <div style={{ flex: deletions, background: t.red, borderRadius: additions > 0 ? "0 3px 3px 0" : "3px" }} />}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  repoName: string;
  onClose: () => void;
  prNumber?: number;
  prTitle?: string;
  prUrl?: string;
  headRefName?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DiffDrawer({ prNumber, repoName, prTitle, prUrl, headRefName, onClose }: Props) {
  const { theme: t } = useTheme();

  // ── Resize ───────────────────────────────────────────────────────────────────
  const [drawerWidth, setDrawerWidth] = useState(720);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: drawerWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const delta = dragState.current.startX - ev.clientX;
      setDrawerWidth(Math.max(280, Math.min(900, dragState.current.startWidth + delta)));
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Tab ──────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"branch-diff" | "working-tree" | "commits">(
    prNumber ? "branch-diff" : "working-tree"
  );

  // ── Branch diff state ─────────────────────────────────────────────────────
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBranchFileIdx, setSelectedBranchFileIdx] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setFiles([]);
    setSelectedBranchFileIdx(null);
    window.terminal.getPRDiff(repoName, prNumber).then((raw) => {
      const parsed = parseDiff(raw);
      setFiles(parsed);
      setSelectedBranchFileIdx(parsed.length > 0 ? 0 : null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [prNumber, repoName]);

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  // ── Working tree state ────────────────────────────────────────────────────
  const [wtStaged, setWtStaged] = useState<WTFile[]>([]);
  const [wtUnstaged, setWtUnstaged] = useState<WTFile[]>([]);
  const [wtLoading, setWtLoading] = useState(false);
  // FIX #5: track hovered key in parent state (not in a child component) so hover persists correctly
  const [wtHovered, setWtHovered] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ path: string; staged: boolean } | null>(null);
  const [parsedFileDiff, setParsedFileDiff] = useState<DiffFile[]>([]);
  const [fileDiffLoading, setFileDiffLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);

  // ── Current branch (working-tree mode) ───────────────────────────────────
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  useEffect(() => {
    if (!prNumber) window.terminal.getRepoBranch(repoName).then(setCurrentBranch).catch(() => {});
  }, [repoName, prNumber]);

  // ── Commits tab state ─────────────────────────────────────────────────────
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitDiff, setCommitDiff] = useState<DiffFile[]>([]);
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);
  const [hoveredCommitHash, setHoveredCommitHash] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const copiedHashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitsLoadedFor = useRef<string | null>(null);

  useEffect(() => () => { if (copiedHashTimer.current) clearTimeout(copiedHashTimer.current); }, []);

  const loadWorkingTree = () => {
    setWtLoading(true);
    window.terminal.getWorkingTree(repoName).then((status) => {
      setWtStaged(status.staged);
      setWtUnstaged(status.unstaged);
      setWtLoading(false);
    }).catch(() => setWtLoading(false));
  };

  useEffect(() => {
    if (activeTab === "working-tree") loadWorkingTree();
  }, [activeTab, repoName]);

  useEffect(() => {
    if (!selectedFile) return;
    setFileDiffLoading(true);
    setParsedFileDiff([]);
    window.terminal.getFileDiff(repoName, selectedFile.path, selectedFile.staged).then((raw) => {
      setParsedFileDiff(parseDiff(raw));
      setFileDiffLoading(false);
    }).catch(() => setFileDiffLoading(false));
  }, [selectedFile?.path, selectedFile?.staged]);

  useEffect(() => {
    if (activeTab !== "commits") return;
    const key = `${repoName}/${headRefName}`;
    if (commitsLoadedFor.current === key) return; // already loaded for this PR
    commitsLoadedFor.current = key;
    setCommitsLoading(true);
    setCommits([]);
    setSelectedCommitHash(null);
    setCommitDiff([]);
    window.terminal.getCommits(repoName, headRefName, prNumber).then((c) => {
      setCommits(c);
      setCommitsLoading(false);
    }).catch(() => setCommitsLoading(false));
  }, [activeTab, repoName, headRefName]);

  useEffect(() => {
    if (!selectedCommitHash) return;
    setCommitDiffLoading(true);
    setCommitDiff([]);
    window.terminal.getCommitDiff(repoName, selectedCommitHash).then((raw) => {
      setCommitDiff(parseDiff(raw));
      setCommitDiffLoading(false);
    }).catch(() => setCommitDiffLoading(false));
  }, [selectedCommitHash]);

  const totalWtChanges = wtStaged.length + wtUnstaged.length;

  const handleStageFile = async (path: string) => {
    await window.terminal.stageFile(repoName, path).catch(() => {});
    loadWorkingTree();
    if (selectedFile?.path === path) setSelectedFile({ path, staged: true });
  };
  const handleUnstageFile = async (path: string) => {
    await window.terminal.unstageFile(repoName, path).catch(() => {});
    loadWorkingTree();
    if (selectedFile?.path === path) setSelectedFile({ path, staged: false });
  };
  const handleStageAll = async () => {
    await window.terminal.stageAll(repoName).catch(() => {});
    loadWorkingTree();
  };
  const handleUnstageAll = async () => {
    await window.terminal.unstageAll(repoName).catch(() => {});
    loadWorkingTree();
  };
  const [discardConfirm, setDiscardConfirm] = useState(false);

  const handleDiscardUnstaged = () => setDiscardConfirm(true);

  const executeDiscardUnstaged = async () => {
    setDiscardConfirm(false);
    await window.terminal.discardUnstaged(repoName).catch(() => {});
    loadWorkingTree();
    if (selectedFile && !selectedFile.staged) setSelectedFile(null);
  };

  const handleCommit = async () => {
    if (!commitMsg.trim() || committing) return;
    setCommitting(true);
    try {
      await window.terminal.gitCommit(repoName, commitMsg.trim());
      setCommitMsg("");
      loadWorkingTree();
    } catch {}
    setCommitting(false);
  };

  const statusColor = (s: string) =>
    s === "M" ? t.orange : s === "A" || s === "?" ? t.green : s === "D" ? t.red : t.label3;

  const hoverBg = t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";

  const [copiedFilePath, setCopiedFilePath] = useState<string | null>(null);

  const renderFileRow = (file: WTFile, isStaged: boolean) => {
    const rowKey = `${isStaged ? "s" : "u"}:${file.path}`;
    const isSelected = selectedFile?.path === file.path && selectedFile?.staged === isStaged;
    const isHov = wtHovered === rowKey;
    const col = statusColor(file.status);
    const selColor = isStaged ? t.green : t.orange;
    const totalChanges = file.additions + file.deletions;
    const addPct = totalChanges > 0 ? (file.additions / totalChanges) * 100 : 0;
    return (
      <div
        key={rowKey}
        onClick={() => setSelectedFile({ path: file.path, staged: isStaged })}
        onMouseEnter={() => setWtHovered(rowKey)}
        onMouseLeave={() => setWtHovered(null)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 12px 6px 10px", cursor: "pointer",
          background: isSelected ? `${selColor}10` : isHov ? hoverBg : "transparent",
          borderLeft: `3px solid ${isSelected ? selColor : "transparent"}`,
          transition: "background 0.1s",
        }}
      >
        {/* Status badge */}
        <span style={{
          fontSize: 9, fontWeight: 700, color: col, background: `${col}18`,
          border: `1px solid ${col}30`, borderRadius: 4, padding: "1px 5px",
          flexShrink: 0, lineHeight: 1.5, minWidth: 14, textAlign: "center" as const,
        }}>{file.status === "?" ? "A" : file.status}</span>

        {/* Filename + dir */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: file.status === "D" ? t.red : t.label1, fontSize: 11, fontWeight: 500,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            textDecoration: file.status === "D" ? "line-through" : "none",
            ...SYS_FONT,
          }}>{file.filename}</div>
          {file.dir && (() => {
            const parts = file.dir.split("/").filter(Boolean);
            const short = parts.length <= 2 ? file.dir : "…/" + parts.slice(-2).join("/");
            return (
              <div style={{
                color: t.label4, fontSize: 9, fontFamily: "monospace",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{short}/</div>
            );
          })()}
        </div>

        {/* Right section: always-visible stats badge + hover actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, position: "relative" }}>
          {/* Stats badge — hidden on hover */}
          <div style={{
            display: "flex", alignItems: "center", gap: 0,
            opacity: isHov ? 0 : 1, transition: "opacity 0.1s",
          }}>
            {totalChanges > 0 && (
              <span style={{
                fontSize: 10, fontFamily: "monospace",
                background: t.isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
                border: `1px solid ${t.borderMid}`, borderRadius: 6,
                padding: "1px 7px", display: "flex", gap: 4,
              }}>
                {file.additions > 0 && <span style={{ color: t.green }}>+{file.additions}</span>}
                {file.additions > 0 && file.deletions > 0 && <span style={{ color: t.label4 }}>·</span>}
                {file.deletions > 0 && <span style={{ color: t.red }}>-{file.deletions}</span>}
              </span>
            )}
            {/* Mini change bar */}
            {totalChanges > 0 && (
              <div style={{
                display: "flex", width: 32, height: 4, borderRadius: 2,
                overflow: "hidden", marginLeft: 5,
                background: t.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
              }}>
                {file.additions > 0 && <div style={{ width: `${addPct}%`, background: t.green }} />}
                {file.deletions > 0 && <div style={{ flex: 1, background: t.red }} />}
              </div>
            )}
          </div>

          {/* Hover action buttons — absolutely overlaid */}
          {isHov && (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {/* Copy path */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(file.path);
                  setCopiedFilePath(file.path);
                  setTimeout(() => setCopiedFilePath(null), 1400);
                }}
                title="Copy path"
                style={{
                  background: t.surface2, border: `1px solid ${t.borderMid}`,
                  borderRadius: 5, color: copiedFilePath === file.path ? t.green : t.label2,
                  cursor: "pointer", fontSize: 9, padding: "2px 6px", transition: "all 0.12s",
                }}
              >{copiedFilePath === file.path ? "✓" : "⎘"}</button>
              {/* Stage / Unstage */}
              <button
                onClick={(e) => { e.stopPropagation(); isStaged ? handleUnstageFile(file.path) : handleStageFile(file.path); }}
                style={{
                  background: isStaged ? t.surface2 : `${t.green}18`,
                  border: `1px solid ${isStaged ? t.border : t.green + "40"}`,
                  borderRadius: 5, color: isStaged ? t.label2 : t.green,
                  cursor: "pointer", fontSize: 9, fontWeight: 600, padding: "2px 8px",
                }}
              >{isStaged ? "Unstage" : "Stage"}</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSectionHeader = (label: string, count: number, actionLabel: string, onAction: () => void, disabled?: boolean) => (
    <div style={{
      display: "flex", alignItems: "center", padding: "5px 12px",
      background: t.isDark ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.025)",
      borderTop: label === "UNSTAGED" ? `1px solid ${t.border}` : "none",
    }}>
      <span style={{ color: t.label4, fontSize: 9, letterSpacing: "0.06em", fontWeight: 700, flex: 1 }}>{label}</span>
      <span style={{ color: t.label4, fontSize: 9, marginRight: 8 }}>{count} file{count !== 1 ? "s" : ""}</span>
      <button
        onClick={disabled ? undefined : onAction}
        disabled={disabled}
        style={{
          background: t.surface2, border: `1px solid ${t.border}`,
          borderRadius: 5, color: disabled ? t.label4 : t.label2,
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 9, fontWeight: 600, padding: "2px 8px", opacity: disabled ? 0.45 : 1,
        }}
        onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.color = t.label1; }}
        onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.color = t.label2; }}
      >{actionLabel}</button>
    </div>
  );

  return (
    <div style={{
      width: drawerWidth, minWidth: 280, flexShrink: 0,
      background: t.surface1, borderLeft: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column", position: "relative",
    }}>
      {/* Discard confirmation modal */}
      {discardConfirm && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 50,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: t.surface1, border: `1px solid ${t.border}`,
            borderRadius: 14, padding: "20px 22px", width: 300,
            boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
          }}>
            <div style={{ color: t.red, fontWeight: 700, fontSize: 14, marginBottom: 8, ...SYS_FONT }}>
              Discard unstaged changes?
            </div>
            <div style={{ color: t.label2, fontSize: 12, marginBottom: 18, lineHeight: 1.6, ...SYS_FONT }}>
              This will permanently discard all unstaged changes in <span style={{ color: t.teal, fontFamily: "monospace" }}>{repoName}</span>. This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setDiscardConfirm(false)}
                style={{
                  background: t.surface2, border: `1px solid ${t.border}`,
                  borderRadius: 8, color: t.label2, cursor: "pointer",
                  fontSize: 12, fontWeight: 600, padding: "6px 16px", ...SYS_FONT,
                }}
              >Cancel</button>
              <button
                onClick={executeDiscardUnstaged}
                style={{
                  background: t.red, border: "none", borderRadius: 8,
                  color: "#FFFFFF", cursor: "pointer",
                  fontSize: 12, fontWeight: 700, padding: "6px 18px", ...SYS_FONT,
                }}
              >Discard</button>
            </div>
          </div>
        </div>
      )}

      {/* Resize handle */}
      <div
        onMouseDown={onResizeMouseDown}
        style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 5,
          cursor: "col-resize", zIndex: 10, background: "transparent",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = `${t.blue}40`; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      />
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ padding: "8px 12px 7px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        {/* Tab bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
          {(["branch-diff", "working-tree", "commits"] as const)
            .filter((tab) => prNumber || tab === "working-tree")
            .map((tab) => {
            const isActive = activeTab === tab;
            const label = tab === "branch-diff" ? "Branch diff" : tab === "working-tree" ? "Working tree" : "Commits";
            const count = tab === "branch-diff" ? (loading ? null : files.length || null) : tab === "working-tree" ? (totalWtChanges || null) : (commits.length || null);
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  background: "none", border: "none",
                  borderBottom: `2px solid ${isActive ? t.green : "transparent"}`,
                  borderRadius: 0,
                  color: isActive ? t.green : t.label3,
                  cursor: "pointer", fontSize: 11, fontWeight: isActive ? 600 : 400,
                  padding: "3px 8px 5px",
                  display: "flex", alignItems: "center", gap: 5,
                }}
              >
                {label}
                {count != null && (
                  <span style={{
                    background: isActive ? `${t.green}20` : (t.isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)"),
                    color: isActive ? t.green : t.label3,
                    borderRadius: 10, fontSize: 9, padding: "0 5px",
                    fontFamily: "monospace", fontWeight: 700,
                  }}>{count}</span>
                )}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 14, padding: "0 2px", lineHeight: 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
          >×</button>
        </div>

        {/* PR title / repo name */}
        {prNumber ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: t.blue, fontSize: 10, fontFamily: "monospace", flexShrink: 0 }}>#{prNumber}</span>
            <span style={{ color: t.label2, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, ...SYS_FONT }}>{prTitle}</span>
            <button
              onClick={() => prUrl && window.terminal.openExternal(prUrl)}
              title="Open in GitHub"
              style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 11, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = t.blue)}
              onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
            >↗</button>
          </div>
        ) : (
          /* Working-tree header: branch + stats + actions */
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {/* Repo + branch pill */}
            <span style={{ color: t.label1, fontSize: 12, fontWeight: 700, ...SYS_FONT }}>{repoName}</span>
            {currentBranch && (
              <span style={{
                fontSize: 10, fontFamily: "monospace", color: t.red,
                background: `${t.red}12`, border: `1px solid ${t.red}30`,
                borderRadius: 10, padding: "0 7px", lineHeight: 1.6,
              }}>git:{currentBranch}</span>
            )}
            {/* File + stat counts */}
            {totalWtChanges > 0 && (
              <span style={{
                fontSize: 10, fontFamily: "monospace", color: t.label3,
                background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                border: `1px solid ${t.borderMid}`,
                borderRadius: 10, padding: "0 7px", lineHeight: 1.6, flexShrink: 0,
              }}>
                {totalWtChanges} · {wtStaged.length > 0 || wtUnstaged.length > 0 ? (
                  <>
                    <span style={{ color: t.green }}>+{[...wtStaged, ...wtUnstaged].reduce((s, f) => s + f.additions, 0)}</span>
                    {" "}
                    <span style={{ color: t.red }}>-{[...wtStaged, ...wtUnstaged].reduce((s, f) => s + f.deletions, 0)}</span>
                  </>
                ) : null}
              </span>
            )}
            <div style={{ flex: 1 }} />
            {/* Uncommitted changes pill */}
            <span style={{
              fontSize: 9, color: t.orange, ...SYS_FONT, fontWeight: 600,
              background: `${t.orange}12`, border: `1px solid ${t.orange}28`,
              borderRadius: 10, padding: "1px 8px", flexShrink: 0,
            }}>Uncommitted</span>
            {/* Discard all */}
            <button
              onClick={handleDiscardUnstaged}
              title="Discard all unstaged"
              style={{
                background: "none", border: `1px solid ${t.borderMid}`,
                borderRadius: 6, color: t.label3, cursor: "pointer",
                fontSize: 10, padding: "1px 7px", flexShrink: 0, ...SYS_FONT,
                transition: "all 0.13s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = t.red; e.currentTarget.style.borderColor = `${t.red}50`; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = t.label3; e.currentTarget.style.borderColor = t.borderMid; }}
            >↺ Discard all</button>
          </div>
        )}

      </div>

      {/* ── Branch diff tab ─────────────────────────────────────────────────── */}
      {activeTab === "branch-diff" && (
        <>
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* ── Left: file list ── */}
            <div style={{
              width: 220, flexShrink: 0, borderRight: `1px solid ${t.border}`,
              display: "flex", flexDirection: "column", overflow: "hidden",
            }}>
              {/* Summary strip */}
              {!loading && files.length > 0 && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
                  borderBottom: `1px solid ${t.border}`,
                  background: t.isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                  flexShrink: 0,
                }}>
                  <span style={{ color: t.label3, fontSize: 10, fontWeight: 600, flex: 1 }}>
                    {files.length} file{files.length !== 1 ? "s" : ""}
                  </span>
                  <span style={{ color: t.green, fontSize: 10, fontFamily: "monospace" }}>+{totalAdditions}</span>
                  <span style={{ color: t.red, fontSize: 10, fontFamily: "monospace" }}>−{totalDeletions}</span>
                </div>
              )}

              <div style={{ flex: 1, overflowY: "auto" }}>
                {loading && (
                  <div style={{ padding: "16px 10px", color: t.label4, fontSize: 10, fontFamily: "monospace" }}>Fetching diff…</div>
                )}
                {!loading && files.length === 0 && (
                  <div style={{ padding: "16px 10px", color: t.label4, fontSize: 10 }}>
                    No diff available.
                    <div style={{ marginTop: 5, fontFamily: "monospace" }}>Ensure <code style={{ color: t.teal }}>gh</code> is authenticated.</div>
                  </div>
                )}
                {!loading && files.map((file, fi) => {
                  const isSelected = fi === selectedBranchFileIdx;
                  const fileName = file.path.split("/").pop() ?? file.path;
                  const fileDir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : "";
                  const statusColor = file.status === "A" ? t.green : file.status === "D" ? t.red : file.status === "M" ? t.orange : t.blue;
                  return (
                    <div
                      key={fi}
                      onClick={() => setSelectedBranchFileIdx(fi)}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = hoverBg; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                      style={{
                        padding: "6px 10px", cursor: "pointer",
                        background: isSelected ? (t.isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)") : "transparent",
                        borderLeft: `3px solid ${isSelected ? statusColor : "transparent"}`,
                        borderBottom: `1px solid ${t.border}`,
                        transition: "background 0.1s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, color: statusColor,
                          background: `${statusColor}18`, border: `1px solid ${statusColor}30`,
                          borderRadius: 3, padding: "0 4px", lineHeight: 1.5, flexShrink: 0,
                        }}>{file.status}</span>
                        <span style={{
                          color: file.status === "D" ? t.red : isSelected ? t.label1 : t.label2,
                          fontSize: 11, fontWeight: isSelected ? 600 : 400,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          textDecoration: file.status === "D" ? "line-through" : "none",
                          flex: 1, ...SYS_FONT,
                        }}>{fileName}</span>
                      </div>
                      {fileDir && (
                        <div style={{
                          color: t.label4, fontSize: 9, fontFamily: "monospace",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          marginBottom: 3, paddingLeft: 22,
                        }}>{fileDir}</div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 5, paddingLeft: 22 }}>
                        {(file.additions > 0 || file.deletions > 0) && (
                          <span style={{ display: "flex", gap: 3, fontSize: 9, fontFamily: "monospace" }}>
                            {file.additions > 0 && <span style={{ color: t.green }}>+{file.additions}</span>}
                            {file.additions > 0 && file.deletions > 0 && <span style={{ color: t.label4 }}>·</span>}
                            {file.deletions > 0 && <span style={{ color: t.red }}>−{file.deletions}</span>}
                          </span>
                        )}
                        <ChangeBar additions={file.additions} deletions={file.deletions} t={t} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Open in GitHub button */}
              <div style={{ borderTop: `1px solid ${t.border}`, padding: "7px 10px", flexShrink: 0 }}>
                <button
                  onClick={() => prUrl && window.terminal.openExternal(prUrl)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5, width: "100%",
                    background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                    border: `1px solid ${t.border}`, borderRadius: 6,
                    color: t.label2, cursor: "pointer", fontSize: 10, fontWeight: 600, padding: "5px 0",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.09)"; e.currentTarget.style.color = t.label1; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"; e.currentTarget.style.color = t.label2; }}
                >↗ Open in GitHub</button>
              </div>
            </div>

            {/* ── Right: diff detail ── */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              {selectedBranchFileIdx == null ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ color: t.label4, fontSize: 11 }}>Select a file to view diff</span>
                </div>
              ) : (() => {
                const file = files[selectedBranchFileIdx];
                const fileName = file.path.split("/").pop() ?? file.path;
                const fileDir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : "";
                return (
                  <>
                    {/* File header */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 7, padding: "5px 12px",
                      borderBottom: `1px solid ${t.border}`, flexShrink: 0,
                      background: t.isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                    }}>
                      {fileDir && (
                        <span style={{ color: t.label4, fontSize: 10, fontFamily: "monospace" }}>{fileDir}</span>
                      )}
                      <span style={{ color: t.label1, fontSize: 11, fontWeight: 600, fontFamily: "monospace" }}>{fileName}</span>
                      <div style={{ flex: 1 }} />
                      {file.additions > 0 && <span style={{ color: t.green, fontSize: 10, fontFamily: "monospace" }}>+{file.additions}</span>}
                      {file.deletions > 0 && <span style={{ color: t.red, fontSize: 10, fontFamily: "monospace" }}>−{file.deletions}</span>}
                    </div>
                    {/* Diff content */}
                    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" }}>
                      <div style={{ minWidth: "max-content" }}>
                        <DiffChunks files={[file]} t={t} />
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </>
      )}

      {/* ── Working tree tab ─────────────────────────────────────────────────── */}
      {/* ── Commits tab ──────────────────────────────────────────────────────── */}
      {activeTab === "commits" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {commitsLoading && <div style={{ padding: "20px 14px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>Loading commits…</div>}
          {!commitsLoading && commits.length === 0 && (
            <div style={{ padding: "20px 14px", color: t.label4, fontSize: 11 }}>No commits found on this branch.</div>
          )}
          {!commitsLoading && commits.length > 0 && (
            <>
              <div style={{
                flexShrink: 0, overflowY: "auto",
                flex: selectedCommitHash ? "none" : 1,
                maxHeight: selectedCommitHash ? 240 : undefined,
              }}>
                {commits.map((commit, i) => {
                  const isBase = i === commits.length - 1;
                  const dotColor = commit.isMerge ? t.purple : isBase ? t.label4 : t.green;
                  const isSelected = selectedCommitHash === commit.hash;
                  const isHov = hoveredCommitHash === commit.hash;
                  const isCopied = copiedHash === commit.hash;
                  const shortHash = commit.hash.slice(0, 7);
                  return (
                    <div
                      key={commit.hash}
                      onClick={() => setSelectedCommitHash(commit.hash)}
                      onMouseEnter={() => setHoveredCommitHash(commit.hash)}
                      onMouseLeave={() => setHoveredCommitHash(null)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
                        cursor: "pointer",
                        background: isSelected ? `${t.green}10` : isHov ? hoverBg : "transparent",
                        borderLeft: `2px solid ${isSelected ? t.green : "transparent"}`,
                        borderBottom: `1px solid ${t.border}`,
                      }}
                    >
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: t.label1, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {commit.subject}
                        </div>
                        <div style={{ color: t.label4, fontSize: 9, fontFamily: "monospace" }}>
                          {commit.author} · {commit.date}
                        </div>
                      </div>
                      {/* Right: hash chip + copy + stats */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              const commitUrl = prUrl?.replace(/\/pull\/\d+.*$/, `/commit/${commit.hash}`);
                              if (commitUrl) window.terminal.openExternal(commitUrl);
                            }}
                            title="Open commit in GitHub"
                            style={{
                              color: t.blue, fontSize: 9, fontFamily: "monospace",
                              background: `${t.blue}18`, border: `1px solid ${t.blue}30`,
                              borderRadius: 3, padding: "0 5px", lineHeight: 1.5, cursor: "pointer",
                            }}
                          >{shortHash}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(commit.hash);
                              setCopiedHash(commit.hash);
                              if (copiedHashTimer.current) clearTimeout(copiedHashTimer.current);
                              copiedHashTimer.current = setTimeout(() => setCopiedHash(null), 1500);
                            }}
                            title="Copy full commit hash"
                            style={{
                              background: t.surface2, border: `1px solid ${t.border}`,
                              borderRadius: 4, color: isCopied ? t.green : t.label3,
                              cursor: "pointer", fontSize: 9, padding: "0 5px", lineHeight: 1.5,
                            }}
                          >{isCopied ? "✓" : "⎘"}</button>
                        </div>
                        <div style={{ display: "flex", gap: 3 }}>
                          {commit.additions > 0 && <span style={{ color: t.green, fontSize: 9, fontFamily: "monospace" }}>+{commit.additions}</span>}
                          {commit.deletions > 0 && <span style={{ color: t.red, fontSize: 9, fontFamily: "monospace" }}>-{commit.deletions}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedCommitHash && (
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderTop: `1px solid ${t.border}` }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "4px 12px",
                    background: t.isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                    borderBottom: `1px solid ${t.border}`, flexShrink: 0,
                  }}>
                    <span style={{
                      color: t.blue, fontSize: 9, fontFamily: "monospace",
                      background: `${t.blue}18`, border: `1px solid ${t.blue}30`,
                      borderRadius: 3, padding: "0 5px", lineHeight: 1.5,
                    }}>{selectedCommitHash.slice(0, 7)}</span>
                    <span style={{ flex: 1, color: t.label2, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {commits.find((c) => c.hash === selectedCommitHash)?.subject}
                    </span>
                    <button
                      onClick={() => setSelectedCommitHash(null)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 13, padding: "0 1px", lineHeight: 1 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                    >×</button>
                  </div>
                  <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" }}>
                    <div style={{ minWidth: "max-content" }}>
                      {commitDiffLoading && <div style={{ padding: "12px 14px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>Loading diff…</div>}
                      {!commitDiffLoading && commitDiff.length === 0 && <div style={{ padding: "12px 14px", color: t.label4, fontSize: 11 }}>No diff available.</div>}
                      {!commitDiffLoading && commitDiff.length > 0 && <DiffChunks files={commitDiff} t={t} />}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === "working-tree" && (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* ── Left: file list + actions ── */}
          <div style={{
            width: 220, flexShrink: 0, borderRight: `1px solid ${t.border}`,
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {wtLoading ? (
              <div style={{ padding: "16px 10px", color: t.label4, fontSize: 10, fontFamily: "monospace" }}>Loading…</div>
            ) : (
              <>
                <div style={{ flex: 1, overflowY: "auto" }}>
                  {renderSectionHeader("STAGED", wtStaged.length, "Unstage all", handleUnstageAll, wtStaged.length === 0)}
                  {wtStaged.length === 0 ? (
                    <div style={{ padding: "7px 10px 6px", color: t.label4, fontSize: 9, fontStyle: "italic" }}>
                      No staged changes
                    </div>
                  ) : wtStaged.map((f) => renderFileRow(f, true))}

                  {renderSectionHeader("UNSTAGED", wtUnstaged.length, "Stage all", handleStageAll, wtUnstaged.length === 0)}
                  {wtUnstaged.length === 0 ? (
                    <div style={{ padding: "7px 10px 6px", color: t.label4, fontSize: 9, fontStyle: "italic" }}>
                      No unstaged changes
                    </div>
                  ) : wtUnstaged.map((f) => renderFileRow(f, false))}
                </div>

                {/* Commit area */}
                {wtStaged.length > 0 && (
                  <div style={{ borderTop: `1px solid ${t.border}`, padding: "7px 10px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                    <textarea
                      value={commitMsg}
                      onChange={(e) => setCommitMsg(e.target.value)}
                      placeholder="Commit message…"
                      rows={2}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCommit(); }}
                      style={{
                        width: "100%", boxSizing: "border-box", resize: "none",
                        background: t.surface2, border: `1px solid ${t.border}`,
                        borderRadius: 5, color: t.label1, fontSize: 11,
                        fontFamily: "inherit", padding: "5px 8px", outline: "none",
                      }}
                    />
                    <button
                      onClick={handleCommit}
                      disabled={!commitMsg.trim() || committing}
                      style={{
                        background: commitMsg.trim() && !committing ? `${t.green}18` : t.surface2,
                        border: `1px solid ${commitMsg.trim() && !committing ? t.green + "40" : t.border}`,
                        borderRadius: 5, color: commitMsg.trim() && !committing ? t.green : t.label4,
                        cursor: commitMsg.trim() && !committing ? "pointer" : "not-allowed",
                        fontSize: 11, fontWeight: 600, padding: "5px 0", opacity: committing ? 0.6 : 1,
                      }}
                    >{committing ? "Committing…" : "Commit staged"}</button>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ borderTop: `1px solid ${t.border}`, padding: "7px 10px", display: "flex", gap: 6, flexShrink: 0 }}>
                  {([
                    { label: "Stage all", action: handleStageAll, hoverCol: t.green },
                    { label: "Discard", action: handleDiscardUnstaged, hoverCol: t.red },
                  ] as const).map(({ label, action, hoverCol }) => (
                    <button
                      key={label}
                      onClick={action}
                      style={{
                        flex: 1, background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                        border: `1px solid ${t.border}`, borderRadius: 6,
                        color: t.label2, cursor: "pointer", fontSize: 10, fontWeight: 600, padding: "5px 0",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = `${hoverCol}18`; e.currentTarget.style.color = hoverCol; e.currentTarget.style.borderColor = `${hoverCol}40`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"; e.currentTarget.style.color = t.label2; e.currentTarget.style.borderColor = t.border; }}
                    >{label}</button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── Right: diff detail ── */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            {!selectedFile ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: t.label4, fontSize: 11 }}>Select a file to view diff</span>
              </div>
            ) : (
              <>
                <div style={{
                  display: "flex", alignItems: "center", gap: 7, padding: "5px 12px",
                  borderBottom: `1px solid ${t.border}`, flexShrink: 0,
                  background: t.isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                }}>
                  <span style={{
                    fontSize: 9, fontWeight: 600,
                    color: selectedFile.staged ? t.green : t.orange,
                    background: selectedFile.staged ? `${t.green}18` : `${t.orange}18`,
                    border: `1px solid ${selectedFile.staged ? t.green + "30" : t.orange + "30"}`,
                    borderRadius: 3, padding: "0 5px", lineHeight: 1.5,
                  }}>{selectedFile.staged ? "staged" : "unstaged"}</span>
                  <span style={{ flex: 1, color: t.label1, fontSize: 11, fontWeight: 600, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {selectedFile.path.split("/").pop()}
                  </span>
                  {(() => {
                    const f = (selectedFile.staged ? wtStaged : wtUnstaged).find((x) => x.path === selectedFile.path);
                    return f ? (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        {f.additions > 0 && <span style={{ color: t.green, fontSize: 10, fontFamily: "monospace" }}>+{f.additions}</span>}
                        {f.deletions > 0 && <span style={{ color: t.red, fontSize: 10, fontFamily: "monospace" }}>-{f.deletions}</span>}
                      </div>
                    ) : null;
                  })()}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" }}>
                  <div style={{ minWidth: "max-content" }}>
                    {fileDiffLoading && <div style={{ padding: "12px 14px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>Loading diff…</div>}
                    {!fileDiffLoading && parsedFileDiff.length === 0 && <div style={{ padding: "12px 14px", color: t.label4, fontSize: 11 }}>No diff available.</div>}
                    {!fileDiffLoading && <DiffChunks files={parsedFileDiff} t={t} />}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
