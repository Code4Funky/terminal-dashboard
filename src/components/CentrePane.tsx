import { useState, useEffect, useRef } from "react";
import { useTheme } from "../ThemeContext";
import { MONO_FONT, SYS_FONT, TABULAR } from "../theme";
import { RADIUS, RADIUS_SM, CLIP, panel, panelHeader, panelTitle, rowState, sectionLabel } from "../chrome";
import {
  WTFile, DiffFile, CommitEntry, parseDiff, DiffChunks, StatBlocks, DiffFileRow, HunkNav,
  RepoGlyph, CopyGlyph, CheckGlyph, OpenGlyph, RefreshGlyph, paneTabStyle, SessionMirror,
} from "./DiffKit";
import { loadRoot, saveRoot } from "../rootMemory";

/** Fixed width of the CHANGES rail; the tabbed pane takes whatever is left. */
const RAIL_W = 240;

export interface SessionGroup {
  id: string;
  title: string;
  dir: "row" | "column";
  /** The mirrored session's own branch, not the rail repo's. */
  branch?: string;
  /** The mirrored session's own repo, not the rail repo — feeds the branch-checkout picker. */
  repo?: string;
  panes: { sessionId: string; number: number }[];
}

interface Props {
  /** Repo whose working tree the CHANGES rail shows, for display and PR lookup. Null → placeholder rail. */
  repoName: string | null;
  /** Checkout root behind `repoName` — every git command runs here, so worktrees resolve correctly. */
  repoRoot: string | null;
  /** Every shell group. Only `activeGroupId` is on screen, but each group opened so far stays
   *  mounted and hidden — re-mounting an xterm replays its log and reprints the restore banner. */
  sessionGroups: SessionGroup[];
  /** The focused group, mirrored into the `>_` tab — a split shows as N panes on one tab, never a
   *  second tab. Follows the focused session, so it may sit outside the rail repo. */
  activeGroupId?: string;
  /** The open file, folded in as a tab. */
  viewerTab?: { path: string; body: React.ReactNode; onClose: () => void };
  /** Git rail toggle — the tabbed pane stays either way. */
  showRail: boolean;
  /** Local branches across all repos — feeds the shell strip's branch-checkout picker. */
  localBranches: { repo: string; branch: string }[];
  onCheckoutBranch: (repoName: string, branch: string) => void;
  /** PR under review, docked as a pane tab + rail view rather than its own column. */
  prReview?: PRReview;
}

export interface PRReview {
  repoName: string;
  prNumber: number;
  prTitle: string;
  prUrl?: string;
  headRefName?: string;
  onClose: () => void;
}

function BranchPicker({
  repo, currentBranch, branches, onCheckout, onClose,
}: {
  repo: string;
  currentBranch?: string;
  branches: { repo: string; branch: string }[];
  onCheckout: (branch: string) => void;
  onClose: () => void;
}) {
  const { theme: t } = useTheme();
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = branches
    .filter((b) => b.repo === repo)
    .map((b) => b.branch)
    .filter((b) => b.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => { setCursor(0); }, [search]);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
      <div style={{
        position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 91,
        width: 220, background: t.surface2, border: `1px solid ${t.border}`,
        borderRadius: RADIUS, boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderBottom: `1px solid ${t.borderSubtle}` }}>
          <span style={{ color: t.label4, fontSize: 11 }}>⌕</span>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); if (filtered[cursor]) onCheckout(filtered[cursor]); }
              else if (e.key === "Escape") { e.preventDefault(); onClose(); }
            }}
            placeholder="Search branches"
            style={{
              flex: 1, minWidth: 0, background: "none", border: "none", outline: "none",
              color: t.label1, fontSize: 11, ...MONO_FONT,
            }}
          />
        </div>
        <div style={{ maxHeight: 200, overflowY: "auto" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "8px 10px", color: t.label4, fontSize: 11, ...SYS_FONT }}>No matching branches.</div>
          )}
          {filtered.map((branch, i) => (
            <div
              key={branch}
              onClick={() => onCheckout(branch)}
              onMouseEnter={() => setCursor(i)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", cursor: "pointer",
                background: cursor === i ? `${t.blue}22` : "none",
                color: t.label1, fontSize: 11, ...MONO_FONT,
              }}
            >
              <span style={{ width: 10, flexShrink: 0, color: t.blue }}>{branch === currentBranch ? "✓" : ""}</span>
              <span style={{ ...CLIP }}>{branch}</span>
            </div>
          ))}
        </div>
        <div style={{
          borderTop: `1px solid ${t.borderSubtle}`, padding: "4px 10px",
          color: t.label4, fontSize: 9, ...SYS_FONT,
        }}>↑↓ navigate · ↵ checkout</div>
      </div>
    </>
  );
}

type WTSelection = { path: string; staged: boolean } | null;

/** The permanent centre pane: one tab strip (session · open file · diff), with the CHANGES rail
 *  docked on its right. Replaces both the terminal dock and the working-tree DiffDrawer. */
export function CentrePane({ repoName, repoRoot, sessionGroups, activeGroupId, viewerTab, showRail, localBranches, onCheckoutBranch, prReview }: Props) {
  const { theme: t } = useTheme();

  // ── Tabs ────────────────────────────────────────────────────────────────────
  const activeGroup = sessionGroups.find((g) => g.id === activeGroupId);
  const panes = activeGroup?.panes ?? [];
  const layoutKey = `${showRail}:${viewerTab ? 1 : 0}`;
  // The shell is home — every fallback returns here when a session exists.
  const homeTab = sessionGroups.length ? "terminal" : "file";
  const [paneTab, setPaneTab] = useState<"viewer" | "file" | "terminal">(homeTab);
  /** Groups mirrored so far. Attaching is what replays the log, so a group is added on first view
   *  and never dropped — that makes switching back a visibility flip, not a fresh terminal. */
  const [openedGroups, setOpenedGroups] = useState<string[]>([]);

  // Shell strip's branch-checkout picker — which group (if any) has it open
  const [branchPickerGroupId, setBranchPickerGroupId] = useState<string | null>(null);
  useEffect(() => { setBranchPickerGroupId(null); }, [activeGroupId]);

  useEffect(() => {
    if (paneTab !== "terminal" || !activeGroupId) return;
    setOpenedGroups((prev) => (prev.includes(activeGroupId) ? prev : [...prev, activeGroupId]));
  }, [paneTab, activeGroupId]);

  // Fall back to the file tab when the last session closes; adopt the shell when the first one
  // lands — the pane mounts at boot, before the restored PTYs exist.
  useEffect(() => {
    if (!sessionGroups.length && paneTab === "terminal") setPaneTab("file");
    if (sessionGroups.length && paneTab === "file" && !selectedFile && !selectedCommitHash && !viewerTab) setPaneTab("terminal");
  }, [sessionGroups.length]);

  // Opening a file is a request to read it; closing it drops back to the shell
  useEffect(() => {
    setPaneTab(viewerTab ? "viewer" : homeTab);
  }, [viewerTab?.path]);

  // ── Working tree state ──────────────────────────────────────────────────────
  const [wtStaged, setWtStaged] = useState<WTFile[]>([]);
  const [wtUnstaged, setWtUnstaged] = useState<WTFile[]>([]);
  const [wtLoading, setWtLoading] = useState(false);
  const [wtHovered, setWtHovered] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<WTSelection>(() => (repoRoot ? loadRoot(repoRoot).diff : null));
  /** Sole write path for the selection — parks it against the checkout so a session switch can restore it. */
  const selectFile = (f: WTSelection) => {
    setSelectedFile(f);
    if (repoRoot) saveRoot(repoRoot, { diff: f });
  };
  const [parsedFileDiff, setParsedFileDiff] = useState<DiffFile[]>([]);
  const [fileDiffLoading, setFileDiffLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [copiedFilePath, setCopiedFilePath] = useState<string | null>(null);

  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  useEffect(() => {
    setCurrentBranch(null);
    if (repoRoot) window.terminal.getRepoBranch(repoRoot).then(setCurrentBranch).catch(() => {});
  }, [repoRoot]);

  // ── Rail view: working tree ⇄ branch ⇄ commits ⇄ PR files ───────────────────
  const [railView, setRailView] = useState<"working-tree" | "branch" | "commits" | "pr-files">("working-tree");
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitDiff, setCommitDiff] = useState<DiffFile[]>([]);
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);
  const [hoveredCommitHash, setHoveredCommitHash] = useState<string | null>(null);
  const commitsLoadedFor = useRef<string | null>(null);

  // ── Branch diff ─────────────────────────────────────────────────────────────
  // Everything the branch changed since it forked, committed or not yet pushed. Local git only —
  // the working-tree view answers "what have I not committed", this answers "what is in the PR".
  const [branchFiles, setBranchFiles] = useState<DiffFile[]>([]);
  const [branchBase, setBranchBase] = useState<string | null>(null);
  const [branchLoading, setBranchLoading] = useState(false);
  // Keyed by path, not index — a refetch after a commit reorders the list under the selection.
  const [selectedBranchPath, setSelectedBranchPath] = useState<string | null>(null);
  const [branchPrNumber, setBranchPrNumber] = useState<number | null>(null);
  const branchKeyRef = useRef<string | null>(null);
  // Refetching the same branch is a React no-op, so the rail's refresh needs its own trigger.
  const [branchTick, setBranchTick] = useState(0);

  // ── PR under review ─────────────────────────────────────────────────────────
  // A PR can live in a repo other than the focused terminal's, so everything PR-side reads `prRepo`.
  const prRepo = prReview?.repoName ?? repoRoot;
  const [prFiles, setPrFiles] = useState<DiffFile[]>([]);
  const [prFilesLoading, setPrFilesLoading] = useState(false);
  const [selectedPrFileIdx, setSelectedPrFileIdx] = useState<number | null>(null);
  // Refetching the same PR is a React no-op, so the rail's refresh needs its own trigger.
  const [prFilesTick, setPrFilesTick] = useState(0);

  /** Scroll container of whichever diff body is on screen — the three are mutually exclusive, so
   *  one ref serves all of them. `HunkNav` only reads it after commit, never during render. */
  const diffScrollRef = useRef<HTMLDivElement>(null);

  // `quiet` swaps the data in place — a watcher-triggered refresh must not flash "Loading…"
  const loadWorkingTree = (quiet = false) => {
    if (!repoRoot) { setWtStaged([]); setWtUnstaged([]); return; }
    if (!quiet) setWtLoading(true);
    window.terminal.getWorkingTree(repoRoot).then((status) => {
      setWtStaged(status.staged);
      setWtUnstaged(status.unstaged);
      setWtLoading(false);
      // A parked selection can outlive its change — drop it rather than render an empty diff
      setSelectedFile((cur) => {
        if (!cur) return cur;
        const live = (cur.staged ? status.staged : status.unstaged).some((f) => f.path === cur.path);
        if (!live) saveRoot(repoRoot, { diff: null });
        return live ? cur : null;
      });
    }).catch(() => setWtLoading(false));
  };

  useEffect(loadWorkingTree, [repoRoot]);

  /** Bumped on every push from the worktree watcher — re-fetches the open diff in place. */
  const [wtTick, setWtTick] = useState(0);

  // Live refresh: any edit, stage or checkout in the rail repo re-fetches rail + branch unprompted.
  useEffect(() => {
    if (!repoRoot) return;
    window.terminal.watchWorkingTree(repoRoot);
    const off = window.terminal.onWorkingTreeChanged((repo) => {
      if (repo !== repoRoot) return;
      loadWorkingTree(true);
      setWtTick((n) => n + 1);
      window.terminal.getRepoBranch(repoRoot).then(setCurrentBranch).catch(() => {});
    });
    return () => { off(); window.terminal.unwatchWorkingTree(); };
  }, [repoRoot]);

  // A repo switch invalidates the diff tabs but not the session tab — that follows the focused
  // session, so staying on it is right. `openedGroups` is untouched, so no live mirror detaches.
  // A PR under review survives it: an unrelated `cd` must not close a diff the user is reading.
  useEffect(() => {
    if (prReview) return;
    const parked = repoRoot ? loadRoot(repoRoot).diff : null;
    setPaneTab((cur) => (cur === "terminal" || (cur === "file" && parked) ? cur : homeTab));
    setSelectedFile(parked);
    setSelectedCommitHash(null);
    setRailView("working-tree");
    setCommits([]);
    setBranchFiles([]);
    setSelectedBranchPath(null);
    commitsLoadedFor.current = null;
    branchKeyRef.current = null;
  }, [repoRoot]);

  // Opening a PR takes over the diff tab and the rail; closing it hands both back to the working tree.
  useEffect(() => {
    setSelectedPrFileIdx(null);
    setSelectedCommitHash(null);
    setCommits([]);
    commitsLoadedFor.current = null;
    if (prReview) {
      setSelectedFile(null);
      setRailView("pr-files");
      setPaneTab("file");
    } else {
      setPrFiles([]);
      setRailView("working-tree");
    }
    setSelectedBranchPath(null);
  }, [prReview?.repoName, prReview?.prNumber]);

  useEffect(() => {
    if (!prReview || !prRepo) return;
    setPrFilesLoading(true);
    setPrFiles([]);
    window.terminal.getPRDiff(prRepo, prReview.prNumber).then((raw) => {
      setPrFiles(parseDiff(raw));
      setPrFilesLoading(false);
    }).catch(() => setPrFilesLoading(false));
  }, [prReview?.repoName, prReview?.prNumber, prFilesTick]);

  // `wtTick` covers commits too — the watcher fires on `refs/`, so committing repaints the branch diff.
  useEffect(() => {
    if (railView !== "branch" || !repoRoot) return;
    const key = `${repoRoot}:${currentBranch}`;
    if (branchKeyRef.current !== key) {
      branchKeyRef.current = key;
      setBranchLoading(true);
      setBranchFiles([]);
    }
    window.terminal.getBranchDiff(repoRoot).then(({ base, diff }) => {
      if (branchKeyRef.current !== key) return;
      setBranchBase(base);
      setBranchFiles(parseDiff(diff));
      setBranchLoading(false);
    }).catch(() => { if (branchKeyRef.current === key) setBranchLoading(false); });
  }, [railView, repoRoot, currentBranch, wtTick, branchTick]);

  // Decorative only — the segment label. Deliberately off the diff's critical path, since this is
  // the one part of the branch view that needs `gh` and the network.
  useEffect(() => {
    setBranchPrNumber(null);
    if (!repoRoot || !currentBranch) return;
    let live = true;
    window.terminal.getBranchPR(repoRoot, currentBranch)
      .then((n) => { if (live) setBranchPrNumber(n); })
      .catch(() => {});
    return () => { live = false; };
  }, [repoRoot, currentBranch]);

  // A selection change repaints with a loading state; a watcher tick swaps the diff in place.
  // The key guard also drops a stale response that resolves after the selection moved on.
  const diffKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedFile || !repoRoot) return;
    const key = `${repoRoot}:${selectedFile.path}:${selectedFile.staged}`;
    if (diffKeyRef.current !== key) {
      diffKeyRef.current = key;
      setFileDiffLoading(true);
      setParsedFileDiff([]);
    }
    window.terminal.getFileDiff(repoRoot, selectedFile.path, selectedFile.staged).then((raw) => {
      if (diffKeyRef.current !== key) return;
      setParsedFileDiff(parseDiff(raw));
      setFileDiffLoading(false);
    }).catch(() => { if (diffKeyRef.current === key) setFileDiffLoading(false); });
  }, [repoRoot, selectedFile?.path, selectedFile?.staged, wtTick]);

  // One commits rail, two sources: a PR's commits come off its head ref, otherwise the local branch.
  const commitsBranch = prReview ? prReview.headRefName : currentBranch;
  useEffect(() => {
    if (railView !== "commits" || !prRepo || !commitsBranch) return;
    const key = `${prRepo}/${commitsBranch}/${prReview?.prNumber ?? ""}`;
    if (commitsLoadedFor.current === key) return;
    commitsLoadedFor.current = key;
    setCommitsLoading(true);
    setCommits([]);
    window.terminal.getCommits(prRepo, commitsBranch, prReview?.prNumber).then((c) => {
      setCommits(c.map((x) => ({ ...x, isLocal: false })));
      setCommitsLoading(false);
    }).catch(() => setCommitsLoading(false));
  }, [railView, prRepo, commitsBranch, prReview?.prNumber]);

  useEffect(() => {
    if (!selectedCommitHash || !prRepo) return;
    setCommitDiffLoading(true);
    setCommitDiff([]);
    window.terminal.getCommitDiff(prRepo, selectedCommitHash).then((raw) => {
      setCommitDiff(parseDiff(raw));
      setCommitDiffLoading(false);
    }).catch(() => setCommitDiffLoading(false));
  }, [selectedCommitHash]);

  const totalWtChanges = wtStaged.length + wtUnstaged.length;
  const wtAdditions = [...wtStaged, ...wtUnstaged].reduce((s, f) => s + f.additions, 0);
  const wtDeletions = [...wtStaged, ...wtUnstaged].reduce((s, f) => s + f.deletions, 0);

  const handleStageFile = async (path: string) => {
    if (!repoRoot) return;
    await window.terminal.stageFile(repoRoot, path).catch(() => {});
    loadWorkingTree();
    if (selectedFile?.path === path) selectFile({ path, staged: true });
  };
  const handleUnstageFile = async (path: string) => {
    if (!repoRoot) return;
    await window.terminal.unstageFile(repoRoot, path).catch(() => {});
    loadWorkingTree();
    if (selectedFile?.path === path) selectFile({ path, staged: false });
  };
  const handleStageAll = async () => {
    if (!repoRoot) return;
    await window.terminal.stageAll(repoRoot).catch(() => {});
    loadWorkingTree();
    // The open diff would otherwise point at an unstaged copy that no longer exists
    if (selectedFile && !selectedFile.staged) selectFile({ path: selectedFile.path, staged: true });
  };
  const handleUnstageAll = async () => {
    if (!repoRoot) return;
    await window.terminal.unstageAll(repoRoot).catch(() => {});
    loadWorkingTree();
    if (selectedFile?.staged) selectFile({ path: selectedFile.path, staged: false });
  };
  const executeDiscardUnstaged = async () => {
    setDiscardConfirm(false);
    if (!repoRoot) return;
    await window.terminal.discardUnstaged(repoRoot).catch(() => {});
    loadWorkingTree();
    if (selectedFile && !selectedFile.staged) selectFile(null);
  };
  const handleCommit = async () => {
    if (!repoRoot || !commitMsg.trim() || committing) return;
    setCommitting(true);
    try {
      await window.terminal.gitCommit(repoRoot, commitMsg.trim());
      setCommitMsg("");
      loadWorkingTree();
    } catch {}
    setCommitting(false);
  };

  const statusColor = (s: string) =>
    s === "M" ? t.blue : s === "A" || s === "?" ? t.teal : s === "D" ? t.diffDelFg : t.label3;

  const hoverBg = t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";

  // ── Rail rows ───────────────────────────────────────────────────────────────

  const renderFileRow = (file: WTFile, isStaged: boolean) => {
    const rowKey = `${isStaged ? "s" : "u"}:${file.path}`;
    const isSelected = railView === "working-tree" && selectedFile?.path === file.path && selectedFile?.staged === isStaged;
    const isHov = wtHovered === rowKey;
    const col = statusColor(file.status);
    const parts = file.dir.split("/").filter(Boolean);
    const shortDir = parts.length === 0 ? "" : parts.length <= 2 ? `/${parts.join("/")}/` : `/${parts.slice(-2).join("/")}/…`;
    return (
      <div
        key={rowKey}
        // Picking a changed file means "show me its diff" — never the editor or the shell
        onClick={() => { selectFile({ path: file.path, staged: isStaged }); setRailView("working-tree"); setPaneTab("file"); }}
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

          {shortDir && (
            <div style={{ color: t.label4, fontSize: 10, marginTop: 1, ...MONO_FONT, ...CLIP }}>{shortDir}</div>
          )}

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

  /** Rail view switcher segment. Same 2px-bottom-accent exception as `paneTabStyle` — a tab strip
   *  has no row for `rowState` to fill. */
  const railTabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, minWidth: 0, height: "100%", padding: "0 4px",
    background: "none", border: "none", cursor: "pointer",
    borderBottom: `2px solid ${active ? t.blue : "transparent"}`,
    borderRight: `1px solid ${t.borderSubtle}`,
    color: active ? t.label1 : t.label3,
    fontSize: 11, fontWeight: active ? 600 : 400,
    ...SYS_FONT, ...CLIP,
  });

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

  // ── Derived tab metadata ────────────────────────────────────────────────────
  const selectedCommit = selectedCommitHash ? commits.find((c) => c.hash === selectedCommitHash) ?? null : null;
  // The diff tab shows the selected working-tree file, commit, or PR file — in that precedence
  const commitMode = railView === "commits" && !!selectedCommit;
  const selectedPrFile = selectedPrFileIdx == null ? null : prFiles[selectedPrFileIdx] ?? null;
  const prMode = railView === "pr-files" && !!selectedPrFile;
  const selectedBranchFile = selectedBranchPath ? branchFiles.find((f) => f.path === selectedBranchPath) ?? null : null;
  const branchMode = railView === "branch" && !!selectedBranchFile;
  /** PR files and branch files are both "a file picked out of a parsed diff" — one pane renders either. */
  const listMode = prMode || branchMode;
  const listFile = prMode ? selectedPrFile : selectedBranchFile;
  const listRepo = prMode ? prRepo : repoRoot;
  const selMeta = selectedFile
    ? [...wtStaged, ...wtUnstaged].find((f) => f.path === selectedFile.path && (selectedFile.staged ? wtStaged.includes(f) : wtUnstaged.includes(f)))
      ?? [...wtStaged, ...wtUnstaged].find((f) => f.path === selectedFile.path)
    : null;
  const crumbs = selectedFile && repoName ? [repoName, ...selectedFile.path.split("/")] : [];
  const listCrumbs = listFile && listRepo ? [listRepo, ...listFile.path.split("/").slice(0, -1)] : [];
  const prAdditions = prFiles.reduce((s, f) => s + f.additions, 0);
  const prDeletions = prFiles.reduce((s, f) => s + f.deletions, 0);
  const branchAdditions = branchFiles.reduce((s, f) => s + f.additions, 0);
  const branchDeletions = branchFiles.reduce((s, f) => s + f.deletions, 0);
  /** What the pane header's copy/open buttons act on. Null hides them — a commit diff spans files. */
  const paneActionFile = paneTab !== "file" ? null
    : listMode ? { repo: listRepo, path: listFile!.path }
    : selectedFile && !commitMode ? { repo: repoRoot, path: selectedFile.path }
    : null;

  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: t.surface1,
      display: "flex", position: "relative",
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

      {/* ── Left: tabbed pane ── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Pane tabs: session · open file · diff — the shell is home, files dock beside it */}
        <div style={{ ...panelHeader(t), padding: 0, gap: 0 }}>
          {activeGroup && panes.length > 0 && (
            <button
              onClick={() => setPaneTab("terminal")}
              style={paneTabStyle(t, paneTab === "terminal")}
            >
              <span style={{ color: t.label4, ...MONO_FONT }}>&gt;_</span>
              <span style={{ ...SYS_FONT, ...CLIP, maxWidth: 200 }}>{activeGroup.title}</span>
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
          {prReview ? (
            /* One tab carries the whole PR review — the label follows whatever the rail has selected */
            <button onClick={() => setPaneTab("file")} style={paneTabStyle(t, paneTab === "file")} title={prReview.prTitle}>
              <span style={{ color: t.blue, fontSize: 10, flexShrink: 0, ...MONO_FONT }}>#{prReview.prNumber}</span>
              {commitMode ? (
                <span style={{ ...SYS_FONT, ...CLIP, maxWidth: 200 }}>{selectedCommit!.subject}</span>
              ) : selectedPrFile ? (
                <span style={{ ...MONO_FONT, ...CLIP, maxWidth: 200 }}>{selectedPrFile.path.split("/").pop()}</span>
              ) : (
                <span style={{ ...SYS_FONT, ...CLIP, maxWidth: 200 }}>{prReview.prTitle}</span>
              )}
              {(commitMode ? selectedCommit : selectedPrFile) && (
                <span style={{ display: "flex", gap: 5, flexShrink: 0, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
                  {(() => { const m = (commitMode ? selectedCommit : selectedPrFile)!; return (<>
                    {m.additions > 0 && <span style={{ color: t.diffAddFg }}>+{m.additions}</span>}
                    {m.deletions > 0 && <span style={{ color: t.diffDelFg }}>−{m.deletions}</span>}
                  </>); })()}
                </span>
              )}
              <span
                role="button"
                title="Close pull request"
                onClick={(e) => { e.stopPropagation(); prReview.onClose(); }}
                style={{ flexShrink: 0, color: t.label4, fontSize: 13, lineHeight: 1, padding: "0 0 0 2px" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
              >×</span>
            </button>
          ) : commitMode ? (
            <button onClick={() => setPaneTab("file")} style={paneTabStyle(t, paneTab === "file")}>
              <span style={{ color: t.label4, fontSize: 10, flexShrink: 0, ...MONO_FONT }}>{selectedCommit!.hash.slice(0, 7)}</span>
              <span style={{ ...SYS_FONT, ...CLIP, maxWidth: 220 }}>{selectedCommit!.subject}</span>
            </button>
          ) : branchMode ? (
            <button onClick={() => setPaneTab("file")} style={paneTabStyle(t, paneTab === "file")} title={selectedBranchFile!.path}>
              <span style={{ ...MONO_FONT, ...CLIP, maxWidth: 220 }}>{selectedBranchFile!.path.split("/").pop()}</span>
              <span style={{ display: "flex", gap: 5, flexShrink: 0, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
                {selectedBranchFile!.additions > 0 && <span style={{ color: t.diffAddFg }}>+{selectedBranchFile!.additions}</span>}
                {selectedBranchFile!.deletions > 0 && <span style={{ color: t.diffDelFg }}>−{selectedBranchFile!.deletions}</span>}
              </span>
            </button>
          ) : selectedFile && (
            <button onClick={() => setPaneTab("file")} style={paneTabStyle(t, paneTab === "file")}>
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
          {paneActionFile && (
            <>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(paneActionFile.path);
                  setCopiedFilePath(paneActionFile.path);
                  setTimeout(() => setCopiedFilePath(null), 1400);
                }}
                title="Copy path"
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: "0 5px", lineHeight: 0,
                  color: copiedFilePath === paneActionFile.path ? t.green : t.label3,
                }}
                onMouseEnter={(e) => { if (copiedFilePath !== paneActionFile.path) e.currentTarget.style.color = t.label1; }}
                onMouseLeave={(e) => { if (copiedFilePath !== paneActionFile.path) e.currentTarget.style.color = t.label3; }}
              >{copiedFilePath === paneActionFile.path ? <CheckGlyph /> : <CopyGlyph />}</button>
              <button
                onClick={() => paneActionFile.repo && window.terminal.openRepoFile(paneActionFile.repo, paneActionFile.path)}
                title="Open in editor"
                style={{ background: "none", border: "none", cursor: "pointer", color: t.label3, padding: "0 5px 0 5px", marginRight: 8, lineHeight: 0 }}
                onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
              ><OpenGlyph /></button>
            </>
          )}
        </div>

        {/* Viewer pane — hidden rather than unmounted so the editor keeps scroll and undo */}
        {viewerTab && (
          <div style={{
            flex: paneTab === "viewer" ? 1 : undefined,
            display: paneTab === "viewer" ? "flex" : "none",
            flexDirection: "column", minHeight: 0, minWidth: 0,
          }}>{viewerTab.body}</div>
        )}

        {/* Session panes — every group opened so far stays mounted; only the active one is shown */}
        {sessionGroups.filter((g) => openedGroups.includes(g.id)).map((group) => {
          const shown = paneTab === "terminal" && group.id === activeGroupId;
          return (
            <div key={group.id} style={{
              flex: shown ? 1 : undefined,
              display: shown ? "flex" : "none",
              flexDirection: "column", minHeight: 0, background: t.bg,
            }}>
              {/* Shell strip — mirrors the panel title bar the tab replaces */}
              <div style={{
                height: 28, flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
                padding: "0 12px", borderBottom: `1px solid ${t.borderSubtle}`, background: t.surface0,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.green, flexShrink: 0 }} />
                <span style={{ color: t.label2, fontSize: 11, ...MONO_FONT }}>zsh</span>
                {group.branch && (
                  <span style={{ position: "relative" }}>
                    <span
                      onClick={() => group.repo && setBranchPickerGroupId((cur) => (cur === group.id ? null : group.id))}
                      title={group.branch}
                      style={{
                        maxWidth: 220, fontSize: 10, color: t.label2, background: t.surface2,
                        borderRadius: RADIUS_SM, padding: "1px 6px", lineHeight: 1.6,
                        display: "inline-flex", alignItems: "center", gap: 3, minWidth: 0,
                        cursor: group.repo ? "pointer" : "default",
                      }}
                    >
                      <span style={{ ...MONO_FONT, ...CLIP }}>{group.branch}</span>
                      {group.repo && <span style={{ fontSize: 7, color: t.label4, flexShrink: 0 }}>▾</span>}
                    </span>
                    {branchPickerGroupId === group.id && group.repo && (
                      <BranchPicker
                        repo={group.repo}
                        currentBranch={group.branch}
                        branches={localBranches}
                        onCheckout={(branch) => { onCheckoutBranch(group.repo!, branch); setBranchPickerGroupId(null); }}
                        onClose={() => setBranchPickerGroupId(null)}
                      />
                    )}
                  </span>
                )}
              </div>
              {/* Split group: every pane on this one tab, on the group's own axis */}
              <div style={{
                flex: 1, minHeight: 0, display: "flex",
                flexDirection: group.dir === "column" ? "column" : "row",
              }}>
                {group.panes.map((p, i) => (
                  <div key={p.sessionId} style={{
                    flex: 1, minWidth: 0, minHeight: 0, padding: "6px 0 6px 10px",
                    ...(i > 0 && group.dir === "column"
                      ? { borderTop: `1px solid ${t.borderSubtle}` }
                      : i > 0 ? { borderLeft: `1px solid ${t.borderSubtle}` } : null),
                  }}>
                    <SessionMirror
                      sessionId={p.sessionId}
                      panelNumber={p.number}
                      visible={shown}
                      owns
                      layoutKey={`${group.panes.length}:${group.dir}:${layoutKey}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {paneTab === "file" && !commitMode && !listMode && !selectedFile && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: t.label4, fontSize: 12, ...SYS_FONT }}>
              {railView === "pr-files"
                ? (prFilesLoading ? "Fetching diff…" : "Select a file to view its diff.")
                : railView === "branch"
                ? (branchLoading ? "Fetching diff…"
                  : !branchBase ? "No base branch to compare against."
                  : branchFiles.length === 0 ? `No changes since ${branchBase}.`
                  : "Select a file to view its diff.")
                : !repoName ? "No repository in focus."
                : totalWtChanges === 0 ? "Working tree is clean."
                : "Select a file to view its diff."}
            </span>
          </div>
        )}

        {/* Diff of a file picked from a list — the PR's files or the branch's, same shape either way */}
        {paneTab === "file" && listMode && (<>
          <div
            title={`${listRepo}/${listFile!.path}`}
            style={{
              height: 28, flexShrink: 0, display: "flex", alignItems: "center", gap: 6,
              padding: "0 12px 0 14px", borderBottom: `1px solid ${t.borderSubtle}`,
              background: t.surface0,
            }}
          >
            <RepoGlyph color={t.label4} />
            <div style={{ flex: 1, fontSize: 11, color: t.label3, ...MONO_FONT, ...CLIP }}>
              {listCrumbs.map((seg, i) => (
                <span key={i}>
                  {i > 0 && <span style={{ color: t.label4, padding: "0 4px" }}>/</span>}
                  {seg}
                </span>
              ))}
            </div>
            <span style={{ display: "flex", gap: 6, flexShrink: 0, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
              {listFile!.additions > 0 && <span style={{ color: t.diffAddFg }}>+{listFile!.additions}</span>}
              {listFile!.deletions > 0 && <span style={{ color: t.diffDelFg }}>−{listFile!.deletions}</span>}
            </span>
            <HunkNav scrollRef={diffScrollRef} resetKey={`${railView}:${listFile!.path}:${listFile!.chunks.length}`} t={t} />
          </div>
          <div ref={diffScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" }}>
            <div style={{ minWidth: "max-content" }}>
              <DiffChunks files={[listFile!]} t={t} />
            </div>
          </div>
        </>)}

        {/* Working-tree file diff */}
        {paneTab === "file" && !commitMode && !listMode && selectedFile && (<>
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
            <HunkNav scrollRef={diffScrollRef} resetKey={`wt:${selectedFile.path}:${selectedFile.staged}:${parsedFileDiff.length}`} t={t} />
          </div>

          {/* Diff body */}
          <div ref={diffScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" }}>
            <div style={{ minWidth: "max-content" }}>
              {fileDiffLoading && <div style={{ padding: "12px 14px", color: t.label4, fontSize: 11, ...MONO_FONT }}>Loading diff…</div>}
              {!fileDiffLoading && parsedFileDiff.length === 0 && <div style={{ padding: "12px 14px", color: t.label4, fontSize: 12, ...SYS_FONT }}>No diff available.</div>}
              {!fileDiffLoading && <DiffChunks files={parsedFileDiff} t={t} />}
            </div>
          </div>
        </>)}

        {/* Commit diff */}
        {paneTab === "file" && commitMode && (<>
          <div style={{
            height: 28, flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
            padding: "0 12px 0 14px", borderBottom: `1px solid ${t.borderSubtle}`,
            background: t.surface0,
          }}>
            <span style={{
              color: t.blue, fontSize: 10, ...MONO_FONT,
              background: `${t.blue}18`, border: `1px solid ${t.blue}30`,
              borderRadius: RADIUS_SM, padding: "0 5px", lineHeight: 1.6, flexShrink: 0,
            }}>{selectedCommit!.hash.slice(0, 7)}</span>
            <span style={{ flex: 1, fontSize: 11, color: t.label2, ...SYS_FONT, ...CLIP }}>{selectedCommit!.subject}</span>
            <span style={{ display: "flex", gap: 6, flexShrink: 0, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
              {selectedCommit!.additions > 0 && <span style={{ color: t.diffAddFg }}>+{selectedCommit!.additions}</span>}
              {selectedCommit!.deletions > 0 && <span style={{ color: t.diffDelFg }}>−{selectedCommit!.deletions}</span>}
            </span>
            <HunkNav scrollRef={diffScrollRef} resetKey={`c:${selectedCommitHash}:${commitDiff.length}`} t={t} />
          </div>
          <div ref={diffScrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" }}>
            <div style={{ minWidth: "max-content" }}>
              {commitDiffLoading && <div style={{ padding: "12px 14px", color: t.label4, fontSize: 11, ...MONO_FONT }}>Loading diff…</div>}
              {!commitDiffLoading && commitDiff.length === 0 && <div style={{ padding: "12px 14px", color: t.label4, fontSize: 12, ...SYS_FONT }}>No diff available.</div>}
              {!commitDiffLoading && commitDiff.map((file) => (
                <div key={file.path}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 7, padding: "5px 12px",
                    borderTop: `1px solid ${t.border}`, background: t.surface0,
                  }}>
                    <span style={{ color: t.label1, fontSize: 11, fontWeight: 600, ...MONO_FONT, ...CLIP }}>{file.path}</span>
                    <div style={{ flex: 1 }} />
                    {file.additions > 0 && <span style={{ color: t.diffAddFg, fontSize: 10, ...MONO_FONT }}>+{file.additions}</span>}
                    {file.deletions > 0 && <span style={{ color: t.diffDelFg, fontSize: 10, ...MONO_FONT }}>−{file.deletions}</span>}
                  </div>
                  <DiffChunks files={[file]} t={t} />
                </div>
              ))}
            </div>
          </div>
        </>)}
      </div>

      {/* ── Right: changes rail ── */}
      {showRail && (
        <div style={{ ...panel(t, "left"), width: RAIL_W, flexShrink: 0, overflow: "hidden" }}>
          <div style={panelHeader(t)}>
            <span style={{ ...panelTitle(t), flex: 1 }}>{prReview ? "Files" : "Changes"}</span>
            {(prReview ? prReview.headRefName : currentBranch) && (
              <span title={prReview ? prReview.headRefName : currentBranch!} style={{
                maxWidth: 90, fontSize: 10, color: t.label2, background: t.surface2,
                borderRadius: RADIUS_SM, padding: "1px 6px", lineHeight: 1.6,
                ...MONO_FONT, ...CLIP,
              }}>{prReview ? prReview.headRefName : currentBranch}</span>
            )}
            <button
              onClick={() => (prReview ? setPrFilesTick((n) => n + 1)
                : railView === "branch" ? setBranchTick((n) => n + 1)
                : loadWorkingTree())}
              title="Refresh"
              style={{ background: "none", border: "none", cursor: "pointer", color: t.label3, padding: "0 2px", lineHeight: 0 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
              onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
            ><RefreshGlyph /></button>
            {prReview?.prUrl && (
              <button
                onClick={() => window.terminal.openExternal(prReview.prUrl!)}
                title="Open in GitHub"
                style={{ background: "none", border: "none", cursor: "pointer", color: t.label3, padding: "0 2px", lineHeight: 0 }}
                onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
              ><OpenGlyph /></button>
            )}
          </div>

          {!prRepo ? (
            <div style={{ padding: "14px 12px", color: t.label4, fontSize: 12, ...SYS_FONT }}>
              No repository in focus.
            </div>
          ) : (<>

          {/* View switcher — the three rail views are peers. PR review keeps its own two-view chain. */}
          {!prReview && (
            <div style={{
              flexShrink: 0, display: "flex", height: 30,
              borderBottom: `1px solid ${t.borderSubtle}`,
            }}>
              {([
                ["working-tree", "Working tree"],
                ["branch", branchPrNumber ? `PR #${branchPrNumber}` : "Branch"],
                ["commits", "Commits"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setRailView(key); if (key !== "commits") setSelectedCommitHash(null); }}
                  title={label}
                  style={railTabStyle(railView === key)}
                >{label}</button>
              ))}
            </div>
          )}

          {railView === "pr-files" ? (
            <>
              {/* PR files summary row — across to the PR's commits */}
              <div style={{
                flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
                padding: "0 12px", height: 30, borderBottom: `1px solid ${t.borderSubtle}`,
              }}>
                <span style={{ color: t.label3, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
                  {prFilesLoading ? "…" : `${prFiles.length} file${prFiles.length === 1 ? "" : "s"}`}
                </span>
                <span style={{ display: "flex", gap: 5, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
                  {prAdditions > 0 && <span style={{ color: t.diffAddFg }}>+{prAdditions}</span>}
                  {prDeletions > 0 && <span style={{ color: t.diffDelFg }}>−{prDeletions}</span>}
                </span>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => setRailView("commits")}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: t.label3, fontSize: 11, ...SYS_FONT }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
                >Commits →</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                {prFilesLoading && <div style={{ padding: "14px 12px", color: t.label4, fontSize: 11, ...MONO_FONT }}>Loading diff…</div>}
                {!prFilesLoading && prFiles.length === 0 && (
                  <div style={{ padding: "14px 12px", color: t.label4, fontSize: 12, ...SYS_FONT }}>
                    No diff available.
                    <div style={{ marginTop: 5, ...MONO_FONT }}>Ensure <code style={{ color: t.teal }}>gh</code> is authenticated.</div>
                  </div>
                )}
                {!prFilesLoading && prFiles.map((f, i) => (
                  <DiffFileRow
                    key={`pr:${i}`}
                    file={f}
                    selected={i === selectedPrFileIdx}
                    onSelect={() => { setSelectedPrFileIdx(i); setPaneTab("file"); }}
                    t={t}
                  />
                ))}
              </div>
            </>
          ) : railView === "branch" ? (
            <>
              {/* Branch summary row */}
              <div style={{
                flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
                padding: "0 12px", height: 30, borderBottom: `1px solid ${t.borderSubtle}`,
              }}>
                <span style={{ color: t.label3, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
                  {branchLoading ? "…" : `${branchFiles.length} file${branchFiles.length === 1 ? "" : "s"}`}
                </span>
                <span style={{ display: "flex", gap: 5, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
                  {branchAdditions > 0 && <span style={{ color: t.diffAddFg }}>+{branchAdditions}</span>}
                  {branchDeletions > 0 && <span style={{ color: t.diffDelFg }}>−{branchDeletions}</span>}
                </span>
                <div style={{ flex: 1 }} />
                {branchBase && (
                  <span title={`Compared against ${branchBase}`} style={{ color: t.label4, fontSize: 10, ...MONO_FONT, ...CLIP, maxWidth: 90 }}>
                    vs {branchBase.replace(/^origin\//, "")}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                {branchLoading && <div style={{ padding: "14px 12px", color: t.label4, fontSize: 11, ...MONO_FONT }}>Loading diff…</div>}
                {!branchLoading && !branchBase && (
                  <div style={{ padding: "14px 12px", color: t.label4, fontSize: 12, ...SYS_FONT }}>
                    No base branch to compare against.
                  </div>
                )}
                {!branchLoading && branchBase && branchFiles.length === 0 && (
                  <div style={{ padding: "14px 12px", color: t.label4, fontSize: 12, ...SYS_FONT }}>
                    No changes since <span style={{ color: t.teal, ...MONO_FONT }}>{branchBase}</span>.
                  </div>
                )}
                {!branchLoading && branchFiles.map((f) => (
                  <DiffFileRow
                    key={`branch:${f.path}`}
                    file={f}
                    selected={f.path === selectedBranchPath}
                    onSelect={() => { setSelectedBranchPath(f.path); setPaneTab("file"); }}
                    t={t}
                  />
                ))}
              </div>
            </>
          ) : railView === "commits" ? (
            <>
              {/* Commits summary row — the PR rail has no switcher, so it keeps its back link */}
              <div style={{
                flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
                padding: "0 12px", height: 30, borderBottom: `1px solid ${t.borderSubtle}`,
              }}>
                {prReview && (
                  <button
                    onClick={() => { setRailView("pr-files"); if (selectedCommitHash) { setSelectedCommitHash(null); } }}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: t.label3, fontSize: 11, ...SYS_FONT }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
                  >← Branch diff</button>
                )}
                <div style={{ flex: 1 }} />
                <span style={{ color: t.label3, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
                  {commitsLoading ? "…" : `${commits.length} commits`}
                </span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                {commitsLoading && <div style={{ padding: "14px 12px", color: t.label4, fontSize: 11, ...MONO_FONT }}>Loading commits…</div>}
                {!commitsLoading && commits.length === 0 && (
                  <div style={{ padding: "14px 12px", color: t.label4, fontSize: 12, ...SYS_FONT }}>No commits found.</div>
                )}
                {!commitsLoading && commits.map((commit, i) => {
                  const isBase = i === commits.length - 1;
                  const dotColor = commit.isMerge ? t.purple : isBase ? t.label4 : t.green;
                  const isSelected = selectedCommitHash === commit.hash;
                  const isHov = hoveredCommitHash === commit.hash;
                  return (
                    <div
                      key={commit.hash}
                      onClick={() => { setSelectedCommitHash(commit.hash); setPaneTab("file"); }}
                      onMouseEnter={() => setHoveredCommitHash(commit.hash)}
                      onMouseLeave={() => setHoveredCommitHash(null)}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 8,
                        padding: "6px 10px 7px 12px", cursor: "pointer",
                        ...rowState(t, isSelected, isHov),
                      }}
                    >
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0, marginTop: 4 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: t.label1, fontSize: 12, fontWeight: isSelected ? 600 : 400, ...SYS_FONT, ...CLIP }}>
                          {commit.subject}
                        </div>
                        <div style={{ color: t.label4, fontSize: 10, marginTop: 1, ...MONO_FONT, ...CLIP }}>
                          {commit.author} · {commit.date}
                        </div>
                        {(commit.additions > 0 || commit.deletions > 0) && (
                          <div style={{ display: "flex", gap: 4, marginTop: 3, fontSize: 10, ...MONO_FONT, ...TABULAR }}>
                            {commit.additions > 0 && <span style={{ color: t.diffAddFg }}>+{commit.additions}</span>}
                            {commit.deletions > 0 && <span style={{ color: t.diffDelFg }}>−{commit.deletions}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {/* Working-tree summary */}
              <div style={{
                flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
                padding: "0 12px", height: 30, borderBottom: `1px solid ${t.borderSubtle}`,
              }}>
                <span style={{ color: t.label3, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
                  {totalWtChanges} file{totalWtChanges === 1 ? "" : "s"}
                </span>
                <span style={{ display: "flex", gap: 5, fontSize: 11, ...MONO_FONT, ...TABULAR }}>
                  {wtAdditions > 0 && <span style={{ color: t.diffAddFg }}>+{wtAdditions}</span>}
                  {wtDeletions > 0 && <span style={{ color: t.diffDelFg }}>−{wtDeletions}</span>}
                </span>
                <div style={{ flex: 1 }} />
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
                      onClick={() => setDiscardConfirm(true)}
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
            </>
          )}

          </>)}
        </div>
      )}
    </div>
  );
}
