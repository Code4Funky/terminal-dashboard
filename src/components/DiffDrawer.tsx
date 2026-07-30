import { useState, useEffect, useRef } from "react";
import { useTheme } from "../ThemeContext";
import { MONO_FONT, SYS_FONT, TABULAR } from "../theme";
import { RADIUS, RADIUS_SM, CLIP, panel, panelHeader, panelTitle, rowState, sectionLabel } from "../chrome";
import {
  DiffFile, WTFile, CommitEntry, parseDiff, DiffChunks, StatBlocks, DiffFileRow,
  RepoGlyph, CopyGlyph, CheckGlyph, OpenGlyph, RefreshGlyph, paneTabStyle, SessionMirror,
} from "./DiffKit";

/** Fixed width of the CHANGES rail; the diff pane takes whatever is left. */
const RAIL_W = 240;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  repoName: string;
  /** The focused shell group, mirrored into a single pane tab — a split shows as N panes on one tab,
   *  never a second tab. Follows the focused session, so it may sit outside this repo. */
  sessionGroup?: {
    title: string;
    dir: "row" | "column";
    /** The mirrored session's own branch, not the drawer repo's. */
    branch?: string;
    panes: { sessionId: string; number: number }[];
  };
  /** The open file, folded in as a tab instead of a second wide column beside this one. */
  viewerTab?: { path: string; body: React.ReactNode; onClose: () => void };
  /** `flightDeck`: this pane owns the row, so Dashboard hands it the viewer instead of docking one.
   *  `hostsSession`: the shell lives in a tab here, so the dock's panel would be a duplicate. */
  onLayout?: (s: { flightDeck: boolean; hostsSession: boolean }) => void;
  onClose: () => void;
  prNumber?: number;
  prTitle?: string;
  prUrl?: string;
  headRefName?: string;
  width?: number;
  onWidthChange?: (w: number) => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  /** Take the whole dock — set when the terminal is hidden, so width/resize no longer apply. */
  fill?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DiffDrawer({ prNumber, repoName, sessionGroup, viewerTab, onLayout, prTitle, prUrl, headRefName, onClose, width: controlledWidth, onWidthChange, maximized = false, onToggleMaximize, fill = false }: Props) {
  const { theme: t } = useTheme();

  // ── Tab ──────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"branch-diff" | "working-tree" | "commits">(
    prNumber ? "branch-diff" : "working-tree"
  );

  // Declared up here, ahead of the rest of the commits state, because the width floor below needs it.
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);

  // ── Resize ───────────────────────────────────────────────────────────────────
  // Every rail-bearing view hands RAIL_W away, so the floor has to leave the diff pane something to
  // work with — a persisted narrow width would otherwise crush it. Only the bare commit list is exempt.
  const railless = activeTab === "commits" && !selectedCommitHash;
  const minWidth = railless ? 280 : RAIL_W + 400;
  const [internalWidth, setInternalWidth] = useState(controlledWidth ?? 720);
  const drawerWidth = Math.max(minWidth, controlledWidth ?? internalWidth);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: drawerWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const delta = dragState.current.startX - ev.clientX;
      // Ceiling tracks the window so dragging a maximised drawer doesn't snap it narrow
      const max = Math.max(900, window.innerWidth - 360);
      const w = Math.max(minWidth, Math.min(max, dragState.current.startWidth + delta));
      if (controlledWidth !== undefined) { onWidthChange?.(w); } else { setInternalWidth(w); }
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Diff-pane tabs (session · file) ──────────────────────────────────────────
  // The session tab mirrors the focused session's panels; it never spawns a shell, so with no panel
  // open at all there is nothing to show and the tab is hidden.
  const panes = sessionGroup?.panes ?? [];
  const paneLayoutKey = `${panes.length}:${sessionGroup?.dir}:${drawerWidth}`;
  // Opening git shouldn't move the shell out from under you — it lands on the session tab and adds
  // file tabs beside it. `homeTab` is where every fallback returns to.
  const homeTab = panes.length ? "terminal" : "file";
  const [paneTab, setPaneTab] = useState<"viewer" | "file" | "terminal">(homeTab);
  const [termOpened, setTermOpened] = useState(false);

  // Attach on first open, not on mount — a drawer opened with no session never touches the mirror
  useEffect(() => {
    if (paneTab === "terminal") setTermOpened(true);
  }, [paneTab]);

  // Fall back to the file tab when the mirrored panels close
  useEffect(() => {
    if (!panes.length && paneTab === "terminal") setPaneTab("file");
  }, [panes.length]);

  // Opening a file is a request to read it; closing it drops back to the shell
  useEffect(() => {
    setPaneTab(viewerTab ? "viewer" : homeTab);
  }, [viewerTab?.path]);

  // A repo switch invalidates the file tabs but not the session tab — that follows the focused
  // session, so staying on it is right. Keeping `termOpened` avoids detaching a live mirror.
  useEffect(() => {
    setPaneTab((cur) => (cur === "terminal" ? cur : homeTab));
  }, [repoName]);

  // ── Branch diff state ─────────────────────────────────────────────────────
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBranchFileIdx, setSelectedBranchFileIdx] = useState<number | null>(null);
  const [branchDiffTick, setBranchDiffTick] = useState(0);

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
  }, [prNumber, repoName, branchDiffTick]);

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
  const effectiveBranch = headRefName ?? currentBranch ?? undefined;

  // ── Commits tab state ─────────────────────────────────────────────────────
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitDiff, setCommitDiff] = useState<DiffFile[]>([]);
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);
  const [hoveredCommitHash, setHoveredCommitHash] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const copiedHashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitsLoadedFor = useRef<string | null>(null);
  const [selectedCommitFileIdx, setSelectedCommitFileIdx] = useState<number | null>(null);
  // Re-selecting the same hash is a React no-op, so the rail's refresh needs its own trigger.
  const [commitDiffTick, setCommitDiffTick] = useState(0);

  useEffect(() => () => { if (copiedHashTimer.current) clearTimeout(copiedHashTimer.current); }, []);

  const loadWorkingTree = () => {
    setWtLoading(true);
    window.terminal.getWorkingTree(repoName).then((status) => {
      setWtStaged(status.staged);
      setWtUnstaged(status.unstaged);
      setWtLoading(false);
    }).catch(() => setWtLoading(false));
  };

  const loadCommits = (branch: string) => {
    commitsLoadedFor.current = null;
    setCommitsLoading(true);
    setCommits([]);
    setSelectedCommitHash(null);
    setCommitDiff([]);
    window.terminal.getCommits(repoName, branch, prNumber).then((c) => {
      commitsLoadedFor.current = `${repoName}/${branch}`;
      setCommits(c);
      setCommitsLoading(false);
    }).catch(() => setCommitsLoading(false));
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
    if (activeTab !== "commits" || !effectiveBranch) return;
    const key = `${repoName}/${effectiveBranch}`;
    if (commitsLoadedFor.current === key) return;
    commitsLoadedFor.current = key;
    setCommitsLoading(true);
    setCommits([]);
    setSelectedCommitHash(null);
    setCommitDiff([]);
    window.terminal.getCommits(repoName, effectiveBranch, prNumber).then((c) => {
      setCommits(c);
      setCommitsLoading(false);
    }).catch(() => setCommitsLoading(false));
  }, [activeTab, repoName, effectiveBranch]);

  useEffect(() => {
    if (!selectedCommitHash) return;
    setCommitDiffLoading(true);
    setCommitDiff([]);
    setSelectedCommitFileIdx(null);
    window.terminal.getCommitDiff(repoName, selectedCommitHash).then((raw) => {
      setCommitDiff(parseDiff(raw));
      setCommitDiffLoading(false);
    }).catch(() => setCommitDiffLoading(false));
  }, [selectedCommitHash, commitDiffTick]);

  const totalWtChanges = wtStaged.length + wtUnstaged.length;
  const wtAdditions = [...wtStaged, ...wtUnstaged].reduce((s, f) => s + f.additions, 0);
  const wtDeletions = [...wtStaged, ...wtUnstaged].reduce((s, f) => s + f.deletions, 0);

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
    // The open diff would otherwise point at an unstaged copy that no longer exists
    if (selectedFile && !selectedFile.staged) setSelectedFile({ path: selectedFile.path, staged: true });
  };
  const handleUnstageAll = async () => {
    await window.terminal.unstageAll(repoName).catch(() => {});
    loadWorkingTree();
    if (selectedFile?.staged) setSelectedFile({ path: selectedFile.path, staged: false });
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
    s === "M" ? t.blue : s === "A" || s === "?" ? t.teal : s === "D" ? t.diffDelFg : t.label3;

  const [copiedFilePath, setCopiedFilePath] = useState<string | null>(null);

  const renderFileRow = (file: WTFile, isStaged: boolean) => {
    const rowKey = `${isStaged ? "s" : "u"}:${file.path}`;
    const isSelected = selectedFile?.path === file.path && selectedFile?.staged === isStaged;
    const isHov = wtHovered === rowKey;
    const col = statusColor(file.status);
    const parts = file.dir.split("/").filter(Boolean);
    const shortDir = parts.length === 0 ? "" : parts.length <= 2 ? `/${parts.join("/")}/` : `/${parts.slice(-2).join("/")}/…`;
    return (
      <div
        key={rowKey}
        // Picking a changed file means "show me its diff" — never the editor or the shell
        onClick={() => { setSelectedFile({ path: file.path, staged: isStaged }); setPaneTab("file"); }}
        onMouseEnter={() => setWtHovered(rowKey)}
        onMouseLeave={() => setWtHovered(null)}
        style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "6px 10px 7px 12px", cursor: "pointer",
          ...rowState(t, isSelected, isHov),
        }}
      >
        {/* Status badge */}
        <span style={{
          width: 15, height: 15, flexShrink: 0, marginTop: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 600, color: col, background: `${col}22`,
          borderRadius: RADIUS_SM, lineHeight: 1, ...SYS_FONT,
        }}>{file.status === "?" ? "A" : file.status}</span>

        {/* Content column: filename row + dir + stats */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Row 1: filename + hover actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{
              flex: 1, ...CLIP,
              color: file.status === "D" ? t.diffDelFg : t.label1,
              fontSize: 12, fontWeight: isSelected ? 600 : 400,
              textDecoration: file.status === "D" ? "line-through" : "none",
              ...SYS_FONT,
            }}>{file.filename}</div>
            {isHov && (
              <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
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
                    borderRadius: RADIUS, color: copiedFilePath === file.path ? t.green : t.label2,
                    cursor: "pointer", padding: "1px 4px 0", lineHeight: 0,
                  }}
                >{copiedFilePath === file.path ? <CheckGlyph /> : <CopyGlyph />}</button>
                <button
                  onClick={(e) => { e.stopPropagation(); isStaged ? handleUnstageFile(file.path) : handleStageFile(file.path); }}
                  style={{
                    background: t.surface2, border: `1px solid ${t.borderMid}`,
                    borderRadius: RADIUS, color: t.label2,
                    cursor: "pointer", fontSize: 10, fontWeight: 600, padding: "1px 7px", ...SYS_FONT,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = isStaged ? t.orange : t.green; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = t.label2; }}
                >{isStaged ? "Unstage" : "Stage"}</button>
              </div>
            )}
          </div>

          {/* Row 2: dir path — last two segments keep the file in context */}
          {shortDir && (
            <div style={{ color: t.label4, fontSize: 10, marginTop: 1, ...MONO_FONT, ...CLIP }}>{shortDir}</div>
          )}

          {/* Row 3: stats */}
          {(file.additions > 0 || file.deletions > 0) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ display: "flex", gap: 4, fontSize: 10, ...MONO_FONT, ...TABULAR }}>
                {file.additions > 0 && <span style={{ color: t.diffAddFg }}>+{file.additions}</span>}
                {file.deletions > 0 && <span style={{ color: t.diffDelFg }}>−{file.deletions}</span>}
              </span>
              <StatBlocks additions={file.additions} deletions={file.deletions} t={t} />
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSectionHeader = (label: string, count: number, actionLabel: string, onAction: () => void, disabled?: boolean) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "14px 12px 5px" }}>
      <span style={{ ...sectionLabel(t), padding: 0, flex: 1 }}>{label}</span>
      <span style={{ fontSize: 11, color: t.label3, ...MONO_FONT, ...TABULAR }}>{count}</span>
      {!disabled && (
        <button
          onClick={onAction}
          style={{
            background: "none", border: "none", padding: 0,
            color: t.blue, cursor: "pointer", fontSize: 11, ...SYS_FONT,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
        >{actionLabel}</button>
      )}
    </div>
  );

  // ── Shared diff-file chrome (branch diff + commits) ───────────────────────
  // Both tabs list `DiffFile`s beside a diff body, so the rail and the pane are written once here
  // rather than copied per tab — which is how the two drifted off the design system before. The row
  // itself lives in DiffKit as `DiffFileRow`, shared with the centre pane's PR rail.

  const railIconBtn: React.CSSProperties = {
    background: "none", border: "none", cursor: "pointer", color: t.label3, padding: "0 2px", lineHeight: 0,
  };

  /** Same geometry as the working tree's CHANGES rail, so switching drawer tabs never moves it. */
  const renderFileRail = (opts: {
    files: DiffFile[];
    loading: boolean;
    selectedIdx: number | null;
    onSelect: (i: number) => void;
    onRefresh: () => void;
    /** Namespaces hover/selection keys so the two tabs can't collide. */
    keyPrefix: string;
    chip?: string;
    trailing?: React.ReactNode;
    emptyHint?: React.ReactNode;
  }) => {
    const { files, loading, selectedIdx, onSelect, onRefresh, keyPrefix, chip, trailing, emptyHint } = opts;
    const adds = files.reduce((s, f) => s + f.additions, 0);
    const dels = files.reduce((s, f) => s + f.deletions, 0);
    return (
      <div style={{ ...panel(t, "left"), width: RAIL_W, flexShrink: 0, overflow: "hidden" }}>
        <div style={panelHeader(t)}>
          <span style={{ ...panelTitle(t), flex: 1 }}>Files</span>
          {chip && (
            <span title={chip} style={{
              maxWidth: 90, fontSize: 10, color: t.label2, background: t.surface2,
              borderRadius: RADIUS_SM, padding: "1px 6px", lineHeight: 1.6,
              ...MONO_FONT, ...CLIP,
            }}>{chip}</span>
          )}
          <button
            onClick={onRefresh}
            title="Refresh"
            style={railIconBtn}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
          ><RefreshGlyph /></button>
          {prUrl && (
            <button
              onClick={() => window.terminal.openExternal(prUrl)}
              title={`Open in GitHub: ${prUrl}`}
              style={railIconBtn}
              onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
              onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
            ><OpenGlyph /></button>
          )}
        </div>

        {/* Summary */}
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
          padding: "0 12px", height: 30, borderBottom: `1px solid ${t.borderSubtle}`,
        }}>
          <span style={{ color: t.label2, fontSize: 12, ...SYS_FONT }}>
            {files.length} file{files.length === 1 ? "" : "s"}
          </span>
          <span style={{ display: "flex", gap: 5, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
            {adds > 0 && <span style={{ color: t.diffAddFg }}>+{adds}</span>}
            {dels > 0 && <span style={{ color: t.diffDelFg }}>−{dels}</span>}
          </span>
          <div style={{ flex: 1 }} />
          {trailing}
        </div>

        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {loading && <div style={{ padding: "14px 12px", color: t.label4, fontSize: 12, ...SYS_FONT }}>Loading diff…</div>}
          {!loading && files.length === 0 && (
            <div style={{ padding: "14px 12px", color: t.label4, fontSize: 12, ...SYS_FONT }}>
              No diff available.{emptyHint}
            </div>
          )}
          {!loading && files.map((f, i) => (
            <DiffFileRow key={`${keyPrefix}:${i}`} file={f} selected={i === selectedIdx} onSelect={() => onSelect(i)} t={t} />
          ))}
        </div>
      </div>
    );
  };

  /** One pane tab, not a strip — the drawer's own tab bar already owns tab switching here. */
  const renderDiffPane = (file: DiffFile | null, emptyLabel: string) => {
    if (!file) {
      return (
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: t.label4, fontSize: 12, ...SYS_FONT }}>{emptyLabel}</span>
        </div>
      );
    }
    const filename = file.path.split("/").pop() ?? file.path;
    const crumbs = [repoName, ...file.path.split("/").slice(0, -1)];
    const stats = (
      <span style={{ display: "flex", gap: 5, flexShrink: 0, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
        {file.additions > 0 && <span style={{ color: t.diffAddFg }}>+{file.additions}</span>}
        {file.deletions > 0 && <span style={{ color: t.diffDelFg }}>−{file.deletions}</span>}
      </span>
    );
    return (
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ ...panelHeader(t), padding: 0, gap: 0 }}>
          <div style={{ ...paneTabStyle(t, true), cursor: "default" }}>
            <span style={{ ...MONO_FONT, ...CLIP, maxWidth: 260 }}>{filename}</span>
            {stats}
          </div>
          <div style={{ flex: 1, borderBottom: "2px solid transparent" }} />
          <button
            onClick={() => {
              navigator.clipboard.writeText(file.path);
              setCopiedFilePath(file.path);
              setTimeout(() => setCopiedFilePath(null), 1400);
            }}
            title="Copy path"
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "0 5px", lineHeight: 0,
              color: copiedFilePath === file.path ? t.green : t.label3,
            }}
            onMouseEnter={(e) => { if (copiedFilePath !== file.path) e.currentTarget.style.color = t.label1; }}
            onMouseLeave={(e) => { if (copiedFilePath !== file.path) e.currentTarget.style.color = t.label3; }}
          >{copiedFilePath === file.path ? <CheckGlyph /> : <CopyGlyph />}</button>
          {/* Opens the local working copy, which on a PR branch may not be this revision */}
          <button
            onClick={() => window.terminal.openRepoFile(repoName, file.path)}
            title="Open in editor"
            style={{ background: "none", border: "none", cursor: "pointer", color: t.label3, padding: "0 5px", marginRight: 8, lineHeight: 0 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
          ><OpenGlyph /></button>
        </div>

        {/* Breadcrumb path */}
        <div
          title={`${repoName}/${file.path}`}
          style={{
            height: 28, flexShrink: 0, display: "flex", alignItems: "center", gap: 6,
            padding: "0 12px 0 14px", borderBottom: `1px solid ${t.borderSubtle}`,
            background: t.surface0,
          }}
        >
          <RepoGlyph color={t.label4} />
          <div style={{ flex: 1, fontSize: 11, color: t.label3, ...MONO_FONT, ...CLIP }}>
            {crumbs.map((seg, i) => (
              <span key={i}>
                {i > 0 && <span style={{ color: t.label4, padding: "0 4px" }}>/</span>}
                {seg}
              </span>
            ))}
          </div>
          {stats}
        </div>

        {/* Diff body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" }}>
          <div style={{ minWidth: "max-content" }}>
            <DiffChunks files={[file]} t={t} />
          </div>
        </div>
      </div>
    );
  };

  // Maximise / refresh / close — in the drawer header normally, folded into the pane tab strip
  // when the working-tree layout drops that header.
  const drawerControls = (
    <>
      {onToggleMaximize && (
        <button
          title={maximized ? "Restore width" : "Maximise"}
          onClick={onToggleMaximize}
          style={{ background: "none", border: "none", cursor: "pointer", color: maximized ? t.blue : t.label4, padding: "0 5px", lineHeight: 0 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = maximized ? t.blue : t.label1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = maximized ? t.blue : t.label4)}
        >
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {maximized
              ? <><polyline points="4 4 10 10 4 16" /><polyline points="11 4 17 10 11 16" /></>
              : <><polyline points="16 4 10 10 16 16" /><polyline points="9 4 3 10 9 16" /></>}
          </svg>
        </button>
      )}
      <button
        title="Refresh"
        onClick={() => {
          if (activeTab === "branch-diff") setBranchDiffTick(n => n + 1);
          else if (activeTab === "working-tree") loadWorkingTree();
          else if (activeTab === "commits" && effectiveBranch) loadCommits(effectiveBranch);
        }}
        style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 12, padding: "0 6px 0 2px", lineHeight: 1 }}
        onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
        onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
      >↻</button>
      <button
        onClick={onClose}
        style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 14, padding: "0 2px", lineHeight: 1 }}
        onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
        onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
      >×</button>
    </>
  );

  /** The mock's layout: the tab strip is the pane header, so the drawer's own header goes away.
   *  Only for a plain repo working tree — a PR still needs its Branch diff switch. */
  const flightDeckLayout = activeTab === "working-tree" && !prNumber;

  const hostsSession = flightDeckLayout && panes.length > 0;
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;
  useEffect(() => {
    onLayout?.({ flightDeck: flightDeckLayout, hostsSession });
  }, [flightDeckLayout, hostsSession]);
  // Reset on unmount only — clearing on every dep change would flash `false` and remount the viewer
  useEffect(() => () => onLayoutRef.current?.({ flightDeck: false, hostsSession: false }), []);

  return (
    <div style={{
      ...(fill ? { flex: 1 } : { width: drawerWidth, flexShrink: 0 }),
      minWidth,
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
            borderRadius: RADIUS, padding: "20px 22px", width: 300,
            boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
          }}>
            <div style={{ color: t.red, fontWeight: 600, fontSize: 14, marginBottom: 8, ...SYS_FONT }}>
              Discard unstaged changes?
            </div>
            <div style={{ color: t.label2, fontSize: 12, marginBottom: 18, lineHeight: 1.6, ...SYS_FONT }}>
              This will permanently discard all unstaged changes in <span style={{ color: t.teal, ...MONO_FONT }}>{repoName}</span>. This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setDiscardConfirm(false)}
                style={{
                  background: t.surface2, border: `1px solid ${t.border}`,
                  borderRadius: RADIUS, color: t.label2, cursor: "pointer",
                  fontSize: 12, fontWeight: 600, padding: "6px 16px", ...SYS_FONT,
                }}
              >Cancel</button>
              <button
                onClick={executeDiscardUnstaged}
                style={{
                  background: t.red, border: "none", borderRadius: RADIUS,
                  color: "#FFFFFF", cursor: "pointer",
                  fontSize: 12, fontWeight: 600, padding: "6px 18px", ...SYS_FONT,
                }}
              >Discard</button>
            </div>
          </div>
        </div>
      )}

      {/* Resize handle — nothing to drag against when filling */}
      {!fill && (
        <div
          onMouseDown={onResizeMouseDown}
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: 5,
            cursor: "col-resize", zIndex: 10, background: "transparent",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = `${t.blue}40`; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        />
      )}
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {!flightDeckLayout && (
      <div style={{ padding: "8px 12px 7px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        {/* Tab bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
          {(["branch-diff", "working-tree", "commits"] as const)
            .filter((tab) => tab === "branch-diff" ? !!prNumber : tab === "commits" ? !!effectiveBranch : true)
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
                  borderBottom: `2px solid ${isActive ? t.blue : "transparent"}`,
                  borderRadius: 0,
                  color: isActive ? t.label1 : t.label3,
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
                    borderRadius: RADIUS, fontSize: 9, padding: "0 5px",
                    ...MONO_FONT, fontWeight: 600,
                  }}>{count}</span>
                )}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          {drawerControls}
        </div>

        {/* PR title / repo name */}
        {prNumber ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: t.blue, fontSize: 10, ...MONO_FONT, flexShrink: 0 }}>#{prNumber}</span>
            <span style={{ color: t.label2, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, ...SYS_FONT }}>{prTitle}</span>
            <button
              onClick={() => prUrl && window.terminal.openExternal(prUrl)}
              title={prUrl ? `Open in GitHub: ${prUrl}` : "Open in GitHub"}
              style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 11, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = t.blue)}
              onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
            >↗</button>
          </div>
        ) : (
          /* Working-tree header: branch + stats + actions */
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {/* Repo + branch pill */}
            <span style={{ color: t.label1, fontSize: 12, fontWeight: 600, ...SYS_FONT }}>{repoName}</span>
            {/* Branch and counts live in the changes rail on the working-tree tab */}
            {currentBranch && activeTab !== "working-tree" && (
              <span style={{
                fontSize: 10, ...MONO_FONT, color: t.red,
                background: `${t.red}12`, border: `1px solid ${t.red}30`,
                borderRadius: RADIUS, padding: "0 7px", lineHeight: 1.6,
              }}>git:{currentBranch}</span>
            )}
            {totalWtChanges > 0 && activeTab !== "working-tree" && (
              <span style={{
                fontSize: 10, ...MONO_FONT, color: t.label3,
                background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                border: `1px solid ${t.borderMid}`,
                borderRadius: RADIUS, padding: "0 7px", lineHeight: 1.6, flexShrink: 0,
              }}>
                {totalWtChanges} · {wtStaged.length > 0 || wtUnstaged.length > 0 ? (
                  <>
                    <span style={{ color: t.diffAddFg }}>+{[...wtStaged, ...wtUnstaged].reduce((s, f) => s + f.additions, 0)}</span>
                    {" "}
                    <span style={{ color: t.diffDelFg }}>-{[...wtStaged, ...wtUnstaged].reduce((s, f) => s + f.deletions, 0)}</span>
                  </>
                ) : null}
              </span>
            )}
            <div style={{ flex: 1 }} />
          </div>
        )}

      </div>
      )}

      {/* ── Branch diff tab ─────────────────────────────────────────────────── */}
      {activeTab === "branch-diff" && (
        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
          {/* ── Left: diff pane ── */}
          {renderDiffPane(
            selectedBranchFileIdx == null ? null : files[selectedBranchFileIdx],
            loading ? "Fetching diff…" : "Select a file to view its diff."
          )}

          {/* ── Right: files rail ── */}
          {renderFileRail({
            files,
            loading,
            selectedIdx: selectedBranchFileIdx,
            onSelect: setSelectedBranchFileIdx,
            onRefresh: () => setBranchDiffTick((n) => n + 1),
            keyPrefix: "bd",
            chip: headRefName,
            trailing: effectiveBranch ? (
              <button
                onClick={() => setActiveTab("commits")}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: t.label3, fontSize: 11, ...SYS_FONT, ...TABULAR }}
                onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
              >{commits.length > 0 ? `${commits.length} commits` : "Commits"}</button>
            ) : undefined,
            emptyHint: (
              <div style={{ marginTop: 5, ...MONO_FONT }}>Ensure <code style={{ color: t.teal }}>gh</code> is authenticated.</div>
            ),
          })}
        </div>
      )}

      {/* ── Working tree tab ─────────────────────────────────────────────────── */}
      {/* ── Commits tab ──────────────────────────────────────────────────────── */}
      {activeTab === "commits" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {commitsLoading && <div style={{ padding: "20px 14px", color: t.label4, fontSize: 11, ...MONO_FONT }}>Loading commits…</div>}
          {!commitsLoading && commits.length === 0 && (
            <div style={{ padding: "20px 14px", color: t.label4, fontSize: 11 }}>No commits found on this branch.</div>
          )}

          {/* ── Commit list (no commit selected) ── */}
          {!commitsLoading && commits.length > 0 && !selectedCommitHash && (
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {commits.map((commit, i) => {
                const isBase = i === commits.length - 1;
                const dotColor = commit.isMerge ? t.purple : isBase ? t.label4 : t.green;
                const dotTooltip = commit.isMerge ? "Merge commit" : isBase ? "Merge base (branch point)" : "Commit on this branch";
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
                      borderBottom: `1px solid ${t.borderSubtle}`,
                      ...rowState(t, false, isHov),
                    }}
                  >
                    <div title={dotTooltip} style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: t.label1, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {commit.subject}
                      </div>
                      <div style={{ color: t.label4, fontSize: 9, ...MONO_FONT }}>
                        {commit.author} · {commit.date}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {commit.isLocal && (
                          <span title="Not yet pushed to remote" style={{
                            color: t.orange, fontSize: 9, ...MONO_FONT,
                            background: `${t.orange}18`, border: `1px solid ${t.orange}30`,
                            borderRadius: RADIUS, padding: "0 5px", lineHeight: 1.5,
                          }}>local</span>
                        )}
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            const commitUrl = prUrl?.replace(/\/pull\/\d+.*$/, `/commit/${commit.hash}`);
                            if (commitUrl) window.terminal.openExternal(commitUrl);
                          }}
                          title="Open commit in GitHub"
                          style={{
                            color: t.blue, fontSize: 9, ...MONO_FONT,
                            background: `${t.blue}18`, border: `1px solid ${t.blue}30`,
                            borderRadius: RADIUS, padding: "0 5px", lineHeight: 1.5, cursor: "pointer",
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
                            borderRadius: RADIUS, color: isCopied ? t.green : t.label3,
                            cursor: "pointer", fontSize: 9, padding: "0 5px", lineHeight: 1.5,
                          }}
                        >{isCopied ? "✓" : "⎘"}</button>
                      </div>
                      <div style={{ display: "flex", gap: 3 }}>
                        {commit.additions > 0 && <span style={{ color: t.diffAddFg, fontSize: 9, ...MONO_FONT }}>+{commit.additions}</span>}
                        {commit.deletions > 0 && <span style={{ color: t.diffDelFg, fontSize: 9, ...MONO_FONT }}>-{commit.deletions}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Commit detail view (commit selected) ── */}
          {!commitsLoading && commits.length > 0 && selectedCommitHash && (() => {
            const selectedCommit = commits.find(c => c.hash === selectedCommitHash)!;
            const selectedIdx = commits.findIndex(c => c.hash === selectedCommitHash);
            const hasPrev = selectedIdx > 0;
            const hasNext = selectedIdx < commits.length - 1;
            const commitGitHubUrl = prUrl?.replace(/\/pull\/\d+.*$/, `/commit/${selectedCommitHash}`);
            const isCopiedNav = copiedHash === selectedCommitHash;
            const selectedFileData = selectedCommitFileIdx != null ? commitDiff[selectedCommitFileIdx] : null;
            const navBtnStyle = (enabled: boolean) => ({
              background: "none", border: `1px solid ${t.border}`,
              borderRadius: RADIUS, color: enabled ? t.label2 : t.label4,
              cursor: enabled ? "pointer" : "default" as const,
              fontSize: 10, padding: "1px 6px", lineHeight: 1.4,
            });
            return (
              <>
                {/* Top nav bar */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
                  borderBottom: `1px solid ${t.border}`, flexShrink: 0,
                  background: t.surface0,
                }}>
                  <button
                    onClick={() => { setSelectedCommitHash(null); setSelectedCommitFileIdx(null); }}
                    title="Back to commits list"
                    style={{ background: "none", border: "none", cursor: "pointer", color: t.label3, fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
                  >←</button>
                  <span style={{
                    color: t.blue, fontSize: 9, ...MONO_FONT,
                    background: `${t.blue}18`, border: `1px solid ${t.blue}30`,
                    borderRadius: RADIUS, padding: "0 5px", lineHeight: 1.5, flexShrink: 0,
                  }}>{selectedCommitHash.slice(0, 7)}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedCommitHash);
                      setCopiedHash(selectedCommitHash);
                      if (copiedHashTimer.current) clearTimeout(copiedHashTimer.current);
                      copiedHashTimer.current = setTimeout(() => setCopiedHash(null), 1500);
                    }}
                    title="Copy full commit hash"
                    style={{
                      background: isCopiedNav ? `${t.green}20` : t.surface2,
                      border: `1px solid ${isCopiedNav ? t.green + "40" : t.border}`,
                      borderRadius: RADIUS, color: isCopiedNav ? t.green : t.label3,
                      cursor: "pointer", fontSize: 9, padding: "0 5px", lineHeight: 1.5,
                      transition: "all 0.15s",
                    }}
                  >{isCopiedNav ? "✓" : "⎘"}</button>
                  {commitGitHubUrl && (
                    <button
                      onClick={() => window.terminal.openExternal(commitGitHubUrl)}
                      title="Open commit in GitHub"
                      style={{
                        background: `${t.blue}15`, border: `1px solid ${t.blue}30`,
                        borderRadius: RADIUS, color: t.blue, cursor: "pointer", fontSize: 9, padding: "0 5px", lineHeight: 1.5,
                      }}
                    >↗</button>
                  )}
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => { if (hasPrev) setSelectedCommitHash(commits[selectedIdx - 1].hash); }}
                    disabled={!hasPrev} title="Newer commit"
                    style={navBtnStyle(hasPrev)}
                  >↑</button>
                  <button
                    onClick={() => { if (hasNext) setSelectedCommitHash(commits[selectedIdx + 1].hash); }}
                    disabled={!hasNext} title="Older commit"
                    style={navBtnStyle(hasNext)}
                  >↓</button>
                </div>

                {/* Commit header */}
                <div style={{
                  padding: "8px 12px", borderBottom: `1px solid ${t.border}`, flexShrink: 0,
                  background: t.surface0,
                }}>
                  <div style={{ color: t.label1, fontSize: 12, fontWeight: 600, lineHeight: 1.4, marginBottom: 5, ...SYS_FONT }}>
                    {selectedCommit.subject}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: t.label4, fontSize: 10, ...MONO_FONT }}>
                      {selectedCommit.author} · {selectedCommit.date}
                    </span>
                    <div style={{ flex: 1 }} />
                    {selectedCommit.additions > 0 && <span style={{ color: t.diffAddFg, fontSize: 10, ...MONO_FONT, fontWeight: 600 }}>+{selectedCommit.additions}</span>}
                    {selectedCommit.deletions > 0 && <span style={{ color: t.diffDelFg, fontSize: 10, ...MONO_FONT, fontWeight: 600 }}>-{selectedCommit.deletions}</span>}
                  </div>
                </div>

                {/* Split: diff pane (left) + files rail (right) — same shape as Branch diff */}
                <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
                  {renderDiffPane(
                    selectedFileData,
                    commitDiffLoading ? "Loading diff\u2026" : "Select a file to view its diff."
                  )}
                  {renderFileRail({
                    files: commitDiff,
                    loading: commitDiffLoading,
                    selectedIdx: selectedCommitFileIdx,
                    onSelect: setSelectedCommitFileIdx,
                    onRefresh: () => setCommitDiffTick((n) => n + 1),
                    keyPrefix: `c:${selectedCommitHash}`,
                    chip: selectedCommitHash.slice(0, 7),
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {activeTab === "working-tree" && (() => {
        const selMeta = selectedFile
          ? (selectedFile.staged ? wtStaged : wtUnstaged).find((x) => x.path === selectedFile.path)
          : undefined;
        const crumbs = selectedFile
          ? [repoName, ...selectedFile.path.split("/").slice(0, -1)]
          : [];
        return (
        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
          {/* ── Left: diff pane ── */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <>
                {/* Pane tabs: session · open file · diff — the shell is home, files dock beside it */}
                <div style={{ ...panelHeader(t), padding: 0, gap: 0 }}>
                  {sessionGroup && panes.length > 0 && (
                  <button
                    onClick={() => setPaneTab("terminal")}
                    style={paneTabStyle(t, paneTab === "terminal")}
                  >
                    <span style={{ color: t.label4, ...MONO_FONT }}>&gt;_</span>
                    <span style={{ ...SYS_FONT, ...CLIP, maxWidth: 200 }}>{sessionGroup.title}</span>
                    {panes.length > 1 && (
                      <span style={{ flexShrink: 0, fontSize: 11, color: t.label4, ...MONO_FONT, ...TABULAR }}>
                        {panes.length}
                      </span>
                    )}
                  </button>
                  )}
                  {viewerTab && (
                  <button
                    onClick={() => setPaneTab("viewer")}
                    style={paneTabStyle(t, paneTab === "viewer")}
                  >
                    <span style={{ color: t.label4, fontSize: 10, flexShrink: 0, ...MONO_FONT }}>{"</>"}</span>
                    <span style={{ ...MONO_FONT, ...CLIP, maxWidth: 220 }}>
                      {viewerTab.path.split("/").pop()}
                    </span>
                    <span
                      role="button"
                      title="Close file"
                      onClick={(e) => { e.stopPropagation(); viewerTab.onClose(); }}
                      style={{ flexShrink: 0, color: t.label4, fontSize: 13, lineHeight: 1, padding: "0 0 0 2px" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
                    >×</span>
                  </button>
                  )}
                  {selectedFile && (
                  <button
                    onClick={() => setPaneTab("file")}
                    style={paneTabStyle(t, paneTab === "file")}
                  >
                    <span style={{ ...MONO_FONT, ...CLIP, maxWidth: 220 }}>
                      {selectedFile.path.split("/").pop()}
                    </span>
                    {selMeta && (
                      <span style={{ display: "flex", gap: 5, flexShrink: 0, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
                        {selMeta.additions > 0 && <span style={{ color: t.diffAddFg }}>+{selMeta.additions}</span>}
                        {selMeta.deletions > 0 && <span style={{ color: t.diffDelFg }}>−{selMeta.deletions}</span>}
                      </span>
                    )}
                  </button>
                  )}
                  <div style={{ flex: 1, borderBottom: `2px solid transparent` }} />
                  {paneTab === "file" && selectedFile && (
                    <>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selectedFile.path);
                          setCopiedFilePath(selectedFile.path);
                          setTimeout(() => setCopiedFilePath(null), 1400);
                        }}
                        title="Copy path"
                        style={{
                          background: "none", border: "none", cursor: "pointer", padding: "0 5px", lineHeight: 0,
                          color: copiedFilePath === selectedFile.path ? t.green : t.label3,
                        }}
                        onMouseEnter={(e) => { if (copiedFilePath !== selectedFile.path) e.currentTarget.style.color = t.label1; }}
                        onMouseLeave={(e) => { if (copiedFilePath !== selectedFile.path) e.currentTarget.style.color = t.label3; }}
                      >{copiedFilePath === selectedFile.path ? <CheckGlyph /> : <CopyGlyph />}</button>
                      <button
                        onClick={() => window.terminal.openRepoFile(repoName, selectedFile.path)}
                        title="Open in editor"
                        style={{ background: "none", border: "none", cursor: "pointer", color: t.label3, padding: "0 5px 0 5px", marginRight: 8, lineHeight: 0 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
                      ><OpenGlyph /></button>
                    </>
                  )}
                  {flightDeckLayout && drawerControls}
                </div>

                {/* Viewer pane — hidden rather than unmounted so the editor keeps scroll and undo */}
                {viewerTab && (
                <div style={{
                  flex: paneTab === "viewer" ? 1 : undefined,
                  display: paneTab === "viewer" ? "flex" : "none",
                  flexDirection: "column", minHeight: 0, minWidth: 0,
                }}>{viewerTab.body}</div>
                )}

                {/* Session pane — kept mounted so the mirror survives tab switches */}
                {sessionGroup && panes.length > 0 && (
                <div style={{
                  flex: paneTab === "terminal" ? 1 : undefined,
                  display: paneTab === "terminal" ? "flex" : "none",
                  flexDirection: "column", minHeight: 0, background: t.bg,
                }}>
                  {/* Shell strip — mirrors the panel title bar the tab replaces */}
                  <div style={{
                    height: 28, flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
                    padding: "0 12px", borderBottom: `1px solid ${t.borderSubtle}`, background: t.surface0,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.green, flexShrink: 0 }} />
                    <span style={{ color: t.label2, fontSize: 11, ...MONO_FONT }}>zsh</span>
                    {sessionGroup.branch && (
                      <span title={sessionGroup.branch} style={{
                        maxWidth: 220, fontSize: 10, color: t.label2, background: t.surface2,
                        borderRadius: RADIUS_SM, padding: "1px 6px", lineHeight: 1.6, ...MONO_FONT, ...CLIP,
                      }}>{sessionGroup.branch}</span>
                    )}
                  </div>
                  {/* Split group: every pane on this one tab, on the group's own axis */}
                  <div style={{
                    flex: 1, minHeight: 0, display: "flex",
                    flexDirection: sessionGroup.dir === "column" ? "column" : "row",
                  }}>
                    {termOpened && panes.map((p, i) => (
                      <div key={p.sessionId} style={{
                        flex: 1, minWidth: 0, minHeight: 0, padding: "6px 0 6px 10px",
                        ...(i > 0 && sessionGroup.dir === "column"
                          ? { borderTop: `1px solid ${t.borderSubtle}` }
                          : i > 0 ? { borderLeft: `1px solid ${t.borderSubtle}` } : null),
                      }}>
                        <SessionMirror
                          sessionId={p.sessionId}
                          panelNumber={p.number}
                          visible={paneTab === "terminal"}
                          owns={fill}
                          layoutKey={paneLayoutKey}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                )}

                {paneTab === "file" && !selectedFile && (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ color: t.label4, fontSize: 12, ...SYS_FONT }}>
                      {totalWtChanges === 0 ? "Working tree is clean." : "Select a file to view its diff."}
                    </span>
                  </div>
                )}

                {paneTab === "file" && selectedFile && (<>
                {/* Breadcrumb path */}
                <div
                  title={`${repoName}/${selectedFile.path}`}
                  style={{
                    height: 28, flexShrink: 0, display: "flex", alignItems: "center", gap: 6,
                    padding: "0 12px 0 14px", borderBottom: `1px solid ${t.borderSubtle}`,
                    background: t.surface0,
                  }}
                >
                  <RepoGlyph color={t.label4} />
                  <div style={{ flex: 1, fontSize: 11, color: t.label3, ...MONO_FONT, ...CLIP }}>
                    {crumbs.map((seg, i) => (
                      <span key={i}>
                        {i > 0 && <span style={{ color: t.label4, padding: "0 4px" }}>/</span>}
                        {seg}
                      </span>
                    ))}
                  </div>
                  {selMeta && (
                    <span style={{ display: "flex", gap: 6, flexShrink: 0, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
                      {selMeta.additions > 0 && <span style={{ color: t.diffAddFg }}>+{selMeta.additions}</span>}
                      {selMeta.deletions > 0 && <span style={{ color: t.diffDelFg }}>−{selMeta.deletions}</span>}
                    </span>
                  )}
                </div>

                {/* Diff body */}
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" }}>
                  <div style={{ minWidth: "max-content" }}>
                    {fileDiffLoading && <div style={{ padding: "12px 14px", color: t.label4, fontSize: 11, ...MONO_FONT }}>Loading diff…</div>}
                    {!fileDiffLoading && parsedFileDiff.length === 0 && <div style={{ padding: "12px 14px", color: t.label4, fontSize: 12, ...SYS_FONT }}>No diff available.</div>}
                    {!fileDiffLoading && <DiffChunks files={parsedFileDiff} t={t} />}
                  </div>
                </div>
                </>)}
              </>
          </div>

          {/* ── Right: changes rail ── */}
          <div style={{ ...panel(t, "left"), width: RAIL_W, flexShrink: 0, overflow: "hidden" }}>
            <div style={panelHeader(t)}>
              <span style={{ ...panelTitle(t), flex: 1 }}>Changes</span>
              {effectiveBranch && (
                <span title={effectiveBranch} style={{
                  maxWidth: 90, fontSize: 10, color: t.label2, background: t.surface2,
                  borderRadius: RADIUS_SM, padding: "1px 6px", lineHeight: 1.6,
                  ...MONO_FONT, ...CLIP,
                }}>{effectiveBranch}</span>
              )}
              <button
                onClick={loadWorkingTree}
                title="Refresh"
                style={{ background: "none", border: "none", cursor: "pointer", color: t.label3, padding: "0 2px", lineHeight: 0 }}
                onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
              ><RefreshGlyph /></button>
            </div>

            {/* Working-tree summary */}
            <div style={{
              flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
              padding: "0 12px", height: 30, borderBottom: `1px solid ${t.borderSubtle}`,
            }}>
              <span style={{ color: t.label2, fontSize: 12, ...SYS_FONT }}>Working tree</span>
              <span style={{ display: "flex", gap: 5, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
                {wtAdditions > 0 && <span style={{ color: t.diffAddFg }}>+{wtAdditions}</span>}
                {wtDeletions > 0 && <span style={{ color: t.diffDelFg }}>−{wtDeletions}</span>}
              </span>
              <div style={{ flex: 1 }} />
              {effectiveBranch && (
                <button
                  onClick={() => setActiveTab("commits")}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: t.label3, fontSize: 11, ...SYS_FONT, ...TABULAR }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
                >{commits.length > 0 ? `${commits.length} commits` : "Commits"}</button>
              )}
            </div>

            {wtLoading ? (
              <div style={{ padding: "14px 12px", color: t.label4, fontSize: 12, ...SYS_FONT }}>Loading…</div>
            ) : (
              <>
                <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }} onMouseLeave={() => setWtHovered(null)}>
                  {renderSectionHeader("Staged", wtStaged.length, "Unstage all", handleUnstageAll, wtStaged.length === 0)}
                  {wtStaged.length === 0 ? (
                    <div style={{ padding: "2px 12px 4px", color: t.label4, fontSize: 12, ...SYS_FONT }}>Nothing staged yet.</div>
                  ) : wtStaged.map((f) => renderFileRow(f, true))}

                  {renderSectionHeader("Unstaged", wtUnstaged.length, "Stage all", handleStageAll, wtUnstaged.length === 0)}
                  {wtUnstaged.length === 0 ? (
                    <div style={{ padding: "2px 12px 4px", color: t.label4, fontSize: 12, ...SYS_FONT }}>Nothing to stage.</div>
                  ) : wtUnstaged.map((f) => renderFileRow(f, false))}
                </div>

                {/* Commit box — only meaningful once something is staged */}
                {wtStaged.length > 0 && (
                  <div style={{ borderTop: `1px solid ${t.borderMid}`, padding: "8px 12px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    <textarea
                      value={commitMsg}
                      onChange={(e) => setCommitMsg(e.target.value)}
                      placeholder="Commit message…"
                      rows={2}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCommit(); }}
                      style={{
                        width: "100%", boxSizing: "border-box", resize: "none",
                        background: t.surface0, border: `1px solid ${t.borderMid}`,
                        borderRadius: RADIUS, color: t.label1, fontSize: 12,
                        padding: "6px 8px", outline: "none", ...SYS_FONT,
                      }}
                    />
                    <button
                      onClick={handleCommit}
                      disabled={!commitMsg.trim() || committing}
                      style={{
                        background: t.surface2, border: `1px solid ${t.borderMid}`,
                        borderRadius: RADIUS, color: commitMsg.trim() && !committing ? t.label1 : t.label4,
                        cursor: commitMsg.trim() && !committing ? "pointer" : "not-allowed",
                        fontSize: 12, fontWeight: 600, padding: "6px 0", ...SYS_FONT,
                      }}
                    >{committing ? "Committing…" : "Commit staged"}</button>
                  </div>
                )}

                {/* Footer actions */}
                <div style={{ borderTop: `1px solid ${t.borderMid}`, padding: "8px 12px", display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={handleStageAll}
                    disabled={wtUnstaged.length === 0}
                    style={{
                      flex: 1, borderRadius: RADIUS, border: "none", padding: "7px 0",
                      background: wtUnstaged.length === 0 ? t.surface2 : t.blue,
                      color: wtUnstaged.length === 0 ? t.label4 : "#FFFFFF",
                      cursor: wtUnstaged.length === 0 ? "not-allowed" : "pointer",
                      fontSize: 12, fontWeight: 600, ...SYS_FONT,
                    }}
                  >Stage all</button>
                  <button
                    onClick={handleDiscardUnstaged}
                    disabled={wtUnstaged.length === 0}
                    style={{
                      borderRadius: RADIUS, border: `1px solid ${t.borderMid}`, padding: "7px 14px",
                      background: "none", color: wtUnstaged.length === 0 ? t.label4 : t.label2,
                      cursor: wtUnstaged.length === 0 ? "not-allowed" : "pointer",
                      fontSize: 12, fontWeight: 600, ...SYS_FONT,
                    }}
                    onMouseEnter={(e) => { if (wtUnstaged.length > 0) { e.currentTarget.style.color = t.red; e.currentTarget.style.borderColor = `${t.red}55`; } }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = wtUnstaged.length === 0 ? t.label4 : t.label2; e.currentTarget.style.borderColor = t.borderMid; }}
                  >Discard</button>
                </div>
              </>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
