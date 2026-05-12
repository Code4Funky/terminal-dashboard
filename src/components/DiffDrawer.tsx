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
        if (line.startsWith("+") && !line.startsWith("+++")) { currentChunk.lines.push({ type: "add", content: line.slice(1) }); additions++; }
        else if (line.startsWith("-") && !line.startsWith("---")) { currentChunk.lines.push({ type: "del", content: line.slice(1) }); deletions++; }
        else if (line.startsWith(" ")) currentChunk.lines.push({ type: "ctx", content: line.slice(1) });
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
// FIX #3: removed overflow/ellipsis from content span so long lines scroll instead of truncate

function DiffChunks({ files, t }: { files: DiffFile[]; t: ReturnType<typeof useTheme>["theme"] }) {
  return (
    <>
      {files.map((file, fi) => (
        <div key={fi}>
          {file.chunks.map((chunk, ci) => (
            <div key={ci}>
              <div style={{
                padding: "2px 12px",
                background: t.isDark ? "rgba(56,139,253,0.08)" : "rgba(0,100,200,0.06)",
                color: t.blue, fontSize: 10, fontFamily: "monospace",
                borderTop: `1px solid ${t.border}`,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{chunk.header}</div>
              {chunk.lines.map((line, li) => (
                <div key={li} style={{
                  display: "flex",
                  background: line.type === "add" ? (t.isDark ? "#0d2818" : "#eaffee") : line.type === "del" ? (t.isDark ? "#2d1117" : "#fff0f0") : "transparent",
                  borderLeft: `2px solid ${line.type === "add" ? t.green : line.type === "del" ? t.red : "transparent"}`,
                }}>
                  <span style={{ color: line.type === "add" ? t.green : line.type === "del" ? t.red : t.label4, fontSize: 11, fontFamily: "monospace", padding: "0 4px", flexShrink: 0, userSelect: "none" }}>
                    {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                  </span>
                  {/* No truncation — parent container scrolls horizontally */}
                  <span style={{
                    color: line.type === "add" ? (t.isDark ? "#aff3c8" : "#24692e") : line.type === "del" ? (t.isDark ? "#ffa198" : "#82071e") : t.label3,
                    fontSize: 11, fontFamily: "monospace",
                    whiteSpace: "pre", paddingRight: 16,
                  }}>{line.content || " "}</span>
                </div>
              ))}
            </div>
          ))}
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
  const [drawerWidth, setDrawerWidth] = useState(360);
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

  // ── File index refs (branch-diff jump-to-file) ───────────────────────────
  const fileRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // ── Branch diff state ─────────────────────────────────────────────────────
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFiles, setExpandedFiles] = useState<Record<number, boolean>>({});
  // per-file: true = show all lines, false/absent = compact (first 5 lines)
  const [fileLineLimits, setFileLineLimits] = useState<Record<number, boolean>>({});
  // how many files to show in the list
  const [fileListLimit, setFileListLimit] = useState(6);

  useEffect(() => {
    setLoading(true);
    setFiles([]);
    setExpandedFiles({});
    setFileLineLimits({});
    setFileListLimit(6);
    window.terminal.getPRDiff(repoName, prNumber).then((raw) => {
      const parsed = parseDiff(raw);
      setFiles(parsed);
      // start all collapsed — user clicks to expand
      setExpandedFiles({});
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
  const [fileListHeight, setFileListHeight] = useState<number | null>(null);
  const fileListDrag = useRef<{ startY: number; startH: number } | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);

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
    window.terminal.getCommits(repoName, headRefName).then((c) => {
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

  const onFileListResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const fileListEl = e.currentTarget.previousElementSibling as HTMLElement | null;
    const currentH = fileListHeight ?? fileListEl?.offsetHeight ?? 160;
    fileListDrag.current = { startY: e.clientY, startH: currentH };
    const onMove = (ev: MouseEvent) => {
      if (!fileListDrag.current) return;
      const delta = ev.clientY - fileListDrag.current.startY;
      setFileListHeight(Math.max(80, Math.min(400, fileListDrag.current.startH + delta)));
    };
    const onUp = () => {
      fileListDrag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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

  // FIX #5: inline JSX instead of a nested component to prevent remount-on-hover
  const renderFileRow = (file: WTFile, isStaged: boolean) => {
    const rowKey = `${isStaged ? "s" : "u"}:${file.path}`;
    const isSelected = selectedFile?.path === file.path && selectedFile?.staged === isStaged;
    const isHov = wtHovered === rowKey;
    const col = statusColor(file.status);
    const selColor = isStaged ? t.green : t.orange;
    return (
      <div
        key={rowKey}
        onClick={() => setSelectedFile({ path: file.path, staged: isStaged })}
        onMouseEnter={() => setWtHovered(rowKey)}
        onMouseLeave={() => setWtHovered(null)}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", cursor: "pointer",
          background: isSelected ? `${selColor}12` : isHov ? hoverBg : "transparent",
          borderLeft: `2px solid ${isSelected ? selColor : "transparent"}`,
        }}
      >
        <span style={{
          fontSize: 9, fontWeight: 700, color: col, background: `${col}18`,
          border: `1px solid ${col}30`, borderRadius: 3, padding: "0 4px",
          flexShrink: 0, lineHeight: 1.5, minWidth: 12, textAlign: "center" as const,
        }}>{file.status === "?" ? "A" : file.status}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: file.status === "D" ? t.red : t.label1, fontSize: 11,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            textDecoration: file.status === "D" ? "line-through" : "none",
          }}>{file.filename}</div>
          {file.dir && (() => {
            const parts = file.dir.split("/").filter(Boolean);
            const short = parts.length <= 2 ? file.dir : "…/" + parts.slice(-2).join("/");
            return <div style={{ color: t.label4, fontSize: 9, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{short}/</div>;
          })()}
        </div>
        {/* FIX #5: hover-reveal stage/unstage button */}
        {isHov ? (
          <button
            onClick={(e) => { e.stopPropagation(); isStaged ? handleUnstageFile(file.path) : handleStageFile(file.path); }}
            style={{
              background: isStaged ? t.surface2 : `${t.green}18`,
              border: `1px solid ${isStaged ? t.border : t.green + "40"}`,
              borderRadius: 4, color: isStaged ? t.label2 : t.green,
              cursor: "pointer", fontSize: 9, fontWeight: 600, padding: "2px 8px", flexShrink: 0,
            }}
          >{isStaged ? "Unstage" : "Stage"}</button>
        ) : (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            {file.additions > 0 && <span style={{ color: t.green, fontSize: 10, fontFamily: "monospace" }}>+{file.additions}</span>}
            {file.deletions > 0 && <span style={{ color: t.red, fontSize: 10, fontFamily: "monospace" }}>-{file.deletions}</span>}
          </div>
        )}
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
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: t.label2, fontSize: 11, fontWeight: 600, ...SYS_FONT }}>{repoName}</span>
            <span style={{ color: t.label4, fontSize: 9, fontFamily: "monospace" }}>working tree</span>
          </div>
        )}

      </div>

      {/* ── Branch diff tab ─────────────────────────────────────────────────── */}
      {activeTab === "branch-diff" && (
        <>
          <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
            {loading && <div style={{ padding: "20px 14px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>Fetching diff…</div>}
            {!loading && files.length === 0 && (
              <div style={{ padding: "20px 14px", color: t.label4, fontSize: 11 }}>
                No diff available.
                <div style={{ marginTop: 6, fontSize: 10, fontFamily: "monospace" }}>Make sure <code style={{ color: t.teal }}>gh</code> is authenticated.</div>
              </div>
            )}
            {!loading && files.length > 0 && (
              <>
                {/* Summary row */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "6px 12px", borderBottom: `1px solid ${t.border}`,
                  background: t.isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                }}>
                  <span style={{ color: t.label2, fontSize: 11, fontWeight: 600 }}>
                    {files.length} file{files.length !== 1 ? "s" : ""} changed
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ color: t.green, fontSize: 10, fontFamily: "monospace", fontWeight: 600 }}>+{totalAdditions}</span>
                    <span style={{ color: t.red, fontSize: 10, fontFamily: "monospace", fontWeight: 600 }}>−{totalDeletions}</span>
                  </div>
                </div>

                {/* File list */}
                {files.slice(0, fileListLimit).map((file, fi) => {
                  const isExpanded = !!expandedFiles[fi];
                  const showAllLines = !!fileLineLimits[fi];
                  const fileName = file.path.split("/").pop() ?? file.path;
                  const fileDir = file.path.includes("/")
                    ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : "";
                  const isDeleted = file.status === "D";
                  const statusColor = file.status === "A" ? t.green
                    : file.status === "D" ? t.red
                    : file.status === "M" ? t.orange : t.blue;

                  // Flatten chunks → [{kind:"header"} | {kind:"line"}]
                  type FlatItem =
                    | { kind: "header"; content: string }
                    | { kind: "line"; type: "add" | "del" | "ctx"; content: string };
                  const flatItems: FlatItem[] = [];
                  for (const chunk of file.chunks) {
                    flatItems.push({ kind: "header", content: chunk.header });
                    for (const line of chunk.lines) flatItems.push({ kind: "line", type: line.type, content: line.content });
                  }
                  const totalDiffLines = flatItems.filter(i => i.kind === "line").length;
                  const LINE_LIMIT = 5;
                  let linesSeen = 0;
                  const visible: FlatItem[] = [];
                  for (const item of flatItems) {
                    if (!showAllLines && item.kind === "line" && linesSeen >= LINE_LIMIT) break;
                    visible.push(item);
                    if (item.kind === "line") linesSeen++;
                  }
                  const hiddenLines = totalDiffLines - linesSeen;

                  return (
                    <div key={fi} ref={(el) => { fileRefs.current[fi] = el; }} style={{ borderBottom: `1px solid ${t.border}` }}>
                      {/* File row */}
                      <div
                        onClick={() => setExpandedFiles((p) => ({ ...p, [fi]: !p[fi] }))}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", cursor: "pointer" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = hoverBg)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <span style={{ color: t.label4, fontSize: 9, width: 8, flexShrink: 0 }}>
                          {isExpanded ? "▼" : "▶"}
                        </span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, color: statusColor,
                          background: `${statusColor}18`, border: `1px solid ${statusColor}30`,
                          borderRadius: 3, padding: "0 4px", lineHeight: 1.5,
                          flexShrink: 0, minWidth: 12, textAlign: "center" as const,
                        }}>{file.status}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{
                            color: isDeleted ? t.red : t.label1,
                            fontSize: 11, fontFamily: "monospace",
                            textDecoration: isDeleted ? "line-through" : "none",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            display: "block",
                          }}>{fileName}</span>
                          {fileDir && (
                            <span style={{
                              color: t.label4, fontSize: 9, fontFamily: "monospace",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              display: "block",
                            }}>{fileDir}</span>
                          )}
                        </div>
                        <ChangeBar additions={file.additions} deletions={file.deletions} t={t} />
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          {file.additions > 0 && <span style={{ color: t.green, fontSize: 10, fontFamily: "monospace" }}>+{file.additions}</span>}
                          {file.deletions > 0 && <span style={{ color: t.red, fontSize: 10, fontFamily: "monospace" }}>−{file.deletions}</span>}
                        </div>
                      </div>

                      {/* Inline diff */}
                      {isExpanded && (
                        <div style={{ overflowX: "auto" }}>
                          <div style={{ minWidth: "max-content" }}>
                            {visible.map((item, idx) =>
                              item.kind === "header" ? (
                                <div key={idx} style={{
                                  padding: "2px 12px",
                                  background: t.isDark ? "rgba(56,139,253,0.08)" : "rgba(0,100,200,0.06)",
                                  color: t.blue, fontSize: 10, fontFamily: "monospace",
                                  borderTop: `1px solid ${t.border}`, whiteSpace: "nowrap",
                                }}>{item.content}</div>
                              ) : (
                                <div key={idx} style={{
                                  display: "flex",
                                  background: item.type === "add" ? (t.isDark ? "#0d2818" : "#eaffee")
                                    : item.type === "del" ? (t.isDark ? "#2d1117" : "#fff0f0") : "transparent",
                                  borderLeft: `2px solid ${item.type === "add" ? t.green : item.type === "del" ? t.red : "transparent"}`,
                                }}>
                                  <span style={{
                                    color: item.type === "add" ? t.green : item.type === "del" ? t.red : t.label4,
                                    fontSize: 11, fontFamily: "monospace", padding: "0 4px", flexShrink: 0, userSelect: "none",
                                  }}>{item.type === "add" ? "+" : item.type === "del" ? "−" : " "}</span>
                                  <span style={{
                                    color: item.type === "add" ? (t.isDark ? "#aff3c8" : "#24692e")
                                      : item.type === "del" ? (t.isDark ? "#ffa198" : "#82071e") : t.label3,
                                    fontSize: 11, fontFamily: "monospace",
                                    whiteSpace: "pre", paddingRight: 16,
                                  }}>{item.content || " "}</span>
                                </div>
                              )
                            )}
                            {hiddenLines > 0 && (
                              <div
                                onClick={(e) => { e.stopPropagation(); setFileLineLimits((p) => ({ ...p, [fi]: true })); }}
                                style={{
                                  padding: "4px 12px", color: t.label4, fontSize: 10,
                                  cursor: "pointer", fontFamily: "monospace",
                                  borderTop: `1px solid ${t.border}`,
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = t.blue)}
                                onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                              >↕ show {hiddenLines} more line{hiddenLines !== 1 ? "s" : ""}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* + N more files */}
                {files.length > fileListLimit && (
                  <div
                    onClick={() => setFileListLimit(files.length)}
                    style={{
                      padding: "8px 12px", color: t.label4, fontSize: 11, cursor: "pointer",
                      borderTop: `1px solid ${t.border}`,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = t.blue)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                  >+ {files.length - fileListLimit} more file{files.length - fileListLimit !== 1 ? "s" : ""}</div>
                )}
              </>
            )}
          </div>
          <div style={{ borderTop: `1px solid ${t.border}`, padding: "8px 12px", flexShrink: 0 }}>
            <button
              onClick={() => prUrl && window.terminal.openExternal(prUrl)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
                background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                border: `1px solid ${t.border}`, borderRadius: 6,
                color: t.label2, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "6px 0",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.09)"; e.currentTarget.style.color = t.label1; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"; e.currentTarget.style.color = t.label2; }}
            ><span style={{ fontSize: 12 }}>↗</span> Open in GitHub</button>
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
                      {/* Always-rendered right section — keeps row height stable */}
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        {/* Hash + stats — always in DOM, hidden on hover */}
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, opacity: isHov ? 0 : 1 }}>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              const commitUrl = prUrl?.replace(/\/pull\/\d+.*$/, `/commit/${commit.hash}`);
                              if (commitUrl) window.terminal.openExternal(commitUrl);
                            }}
                            style={{
                              color: t.blue, fontSize: 9, fontFamily: "monospace",
                              background: `${t.blue}18`, border: `1px solid ${t.blue}30`,
                              borderRadius: 3, padding: "0 5px", lineHeight: 1.5, cursor: "pointer",
                            }}
                          >{shortHash}</span>
                          <div style={{ display: "flex", gap: 3 }}>
                            {commit.additions > 0 && <span style={{ color: t.green, fontSize: 9, fontFamily: "monospace" }}>+{commit.additions}</span>}
                            {commit.deletions > 0 && <span style={{ color: t.red, fontSize: 9, fontFamily: "monospace" }}>-{commit.deletions}</span>}
                          </div>
                        </div>
                        {/* Copy button — absolutely overlaid, shown on hover */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(commit.hash);
                            setCopiedHash(commit.hash);
                            if (copiedHashTimer.current) clearTimeout(copiedHashTimer.current);
                            copiedHashTimer.current = setTimeout(() => setCopiedHash(null), 1500);
                          }}
                          style={{
                            position: "absolute", inset: 0,
                            opacity: isHov ? 1 : 0, pointerEvents: isHov ? "auto" : "none",
                            background: t.surface2, border: `1px solid ${t.border}`,
                            borderRadius: 4, color: isCopied ? t.green : t.label2,
                            cursor: "pointer", fontSize: 9, fontWeight: 600,
                          }}
                        >{isCopied ? "✓" : "Copy"}</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedCommitHash && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderTop: `1px solid ${t.border}` }}>
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
                  <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
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
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {wtLoading && <div style={{ padding: "20px 14px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>Loading…</div>}

          {!wtLoading && (
            <>
              <div style={{
                flexShrink: 0,
                overflowY: "auto",
                height: fileListHeight ?? undefined,
                minHeight: 80,
                maxHeight: fileListHeight ? undefined : (selectedFile ? 200 : undefined),
                flex: fileListHeight ? "none" : (selectedFile ? "none" : 1),
              }}>
                {/* FIX #1: always render STAGED section; show empty state when no staged files */}
                {renderSectionHeader("STAGED", wtStaged.length, "Unstage all", handleUnstageAll, wtStaged.length === 0)}
                {wtStaged.length === 0 ? (
                  <div style={{ padding: "8px 14px 6px 14px", color: t.label4, fontSize: 10, fontStyle: "italic" }}>
                    No staged changes — select files below to stage
                  </div>
                ) : (
                  wtStaged.map((f) => renderFileRow(f, true))
                )}

                {renderSectionHeader("UNSTAGED", wtUnstaged.length, "Stage all", handleStageAll, wtUnstaged.length === 0)}
                {wtUnstaged.length === 0 ? (
                  <div style={{ padding: "8px 14px 6px 14px", color: t.label4, fontSize: 10, fontStyle: "italic" }}>
                    No unstaged changes
                  </div>
                ) : (
                  wtUnstaged.map((f) => renderFileRow(f, false))
                )}
              </div>

              {/* Resize handle between file list and diff preview */}
              {selectedFile && (
                <div
                  onMouseDown={onFileListResizeMouseDown}
                  style={{
                    height: 5, flexShrink: 0, cursor: "row-resize", background: "transparent",
                    borderTop: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}`,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `${t.blue}40`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                />
              )}

              {/* Diff preview */}
              {selectedFile && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "4px 12px",
                    background: t.isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                    borderBottom: `1px solid ${t.border}`, flexShrink: 0,
                  }}>
                    <span style={{
                      fontSize: 9, fontWeight: 600,
                      color: selectedFile.staged ? t.green : t.orange,
                      background: selectedFile.staged ? `${t.green}18` : `${t.orange}18`,
                      border: `1px solid ${selectedFile.staged ? t.green + "30" : t.orange + "30"}`,
                      borderRadius: 3, padding: "0 5px", lineHeight: 1.5,
                    }}>{selectedFile.staged ? "staged" : "unstaged"}</span>
                    <span style={{ flex: 1, color: t.label2, fontSize: 10, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                    <button
                      onClick={() => setSelectedFile(null)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 13, padding: "0 1px", lineHeight: 1 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                    >×</button>
                  </div>
                  <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
                    <div style={{ minWidth: "max-content" }}>
                      {fileDiffLoading && <div style={{ padding: "12px 14px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>Loading diff…</div>}
                      {!fileDiffLoading && parsedFileDiff.length === 0 && <div style={{ padding: "12px 14px", color: t.label4, fontSize: 11 }}>No diff available.</div>}
                      {!fileDiffLoading && <DiffChunks files={parsedFileDiff} t={t} />}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {wtStaged.length > 0 && (
            <div style={{ borderTop: `1px solid ${t.border}`, padding: "8px 12px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
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
                  fontFamily: "inherit",
                  padding: "5px 8px", outline: "none",
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
                  fontSize: 11, fontWeight: 600, padding: "5px 0",
                  opacity: committing ? 0.6 : 1,
                }}
              >{committing ? "Committing…" : "Commit staged"}</button>
            </div>
          )}
          <div style={{ borderTop: `1px solid ${t.border}`, padding: "8px 12px", display: "flex", gap: 8, flexShrink: 0 }}>
            {([
              { label: "Stage all changes", action: handleStageAll, hoverCol: t.green },
              { label: "Discard unstaged", action: handleDiscardUnstaged, hoverCol: t.red },
            ] as const).map(({ label, action, hoverCol }) => (
              <button
                key={label}
                onClick={action}
                style={{
                  flex: 1, background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                  border: `1px solid ${t.border}`, borderRadius: 7,
                  color: t.label2, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "7px 0",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = `${hoverCol}18`; e.currentTarget.style.color = hoverCol; e.currentTarget.style.borderColor = `${hoverCol}40`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"; e.currentTarget.style.color = t.label2; e.currentTarget.style.borderColor = t.border; }}
              >{label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
