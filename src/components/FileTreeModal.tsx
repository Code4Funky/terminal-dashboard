import { useState, useEffect, useRef, useMemo } from "react";
import type { CSSProperties } from "react";
import { useTheme } from "../ThemeContext";
import { useSettings } from "../SettingsContext";
import { loadRoot, saveRoot } from "../rootMemory";
import { SYS_FONT, MONO_FONT, TABULAR } from "../theme";
import { panelHeader, panelTitle, sectionLabel, rowState, chip as chipStyle, CLIP, CLIP_LEFT, RADIUS, RADIUS_SM, TRANSITION } from "../chrome";
import type { GrepHit } from "../hooks/useTerminal";

/** Rows rendered before the "N more files" tail. Also the server-side preview-scan budget. */
const RESULT_LIMIT = 40;

const SEARCH_MODE_KEY = "td_search_mode";

function loadSearchMode(): { caseSensitive: boolean; regex: boolean } {
  try {
    const raw = localStorage.getItem(SEARCH_MODE_KEY);
    if (raw) return { caseSensitive: false, regex: false, ...JSON.parse(raw) };
  } catch { /* corrupt or unavailable — defaults are fine */ }
  return { caseSensitive: false, regex: false };
}

const iconBtn: CSSProperties = {
  width: 20, height: 20, flex: "none",
  display: "flex", alignItems: "center", justifyContent: "center",
  background: "none", border: "none", borderRadius: RADIUS_SM,
  cursor: "pointer", lineHeight: 1, padding: 0, transition: TRANSITION,
};

interface TreeEntry { name: string; isDir: boolean; path: string; }
export interface FileRef { repo: string; path: string; line?: number; match?: string; }
interface Props {
  repoName: string; // bare repo name, or an absolute path for an arbitrary root
  onClose: () => void;
  linked?: boolean;
  onToggleLink?: () => void;
  allRepos?: string[];
  width?: number;
  onWidthChange?: (w: number) => void;
  selected?: FileRef | null;
  onSelectFile: (file: FileRef) => void;
  onPickRoot?: () => void;
}

function envChip(filePath: string): { label: string; color: string } | null {
  const parts = filePath.split("/");
  if (parts.length < 2) return null;
  const dir = parts[parts.length - 2];
  const m = dir.match(/-(perf|prod(?:-[\w]+)?|test|dev|staging(?:-[\w]+)?|uat)$/i);
  if (!m) return null;
  const env = m[1].toLowerCase();
  const color = env.startsWith("prod") ? "#FF453A"
    : env === "perf" ? "#0A84FF"
    : env === "test" || env === "dev" ? "#30D158"
    : "#FF9F0A";
  return { label: m[1], color };
}

/** Match spans for one line under the active search mode — the single source of truth for
 *  filename filtering and preview highlighting, mirroring the flags handed to grep. */
function matchRanges(line: string, query: string, caseSensitive: boolean, regex: boolean): [number, number][] {
  if (!query) return [];
  const out: [number, number][] = [];
  if (regex) {
    let re: RegExp;
    try { re = new RegExp(query, caseSensitive ? "g" : "gi"); } catch { return []; }
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m[0]) out.push([m.index, m.index + m[0].length]);
      else re.lastIndex++; // a zero-width match would never advance
    }
    return out;
  }
  const hay = caseSensitive ? line : line.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
    out.push([at, at + needle.length]);
  }
  return out;
}

function highlight(line: string, ranges: [number, number][], markBg: string, markFg: string) {
  if (!ranges.length) return line;
  const out: (string | JSX.Element)[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start < at) continue; // overlapping spans can't both be marked
    if (start > at) out.push(line.slice(at, start));
    out.push(
      <mark key={start} style={{ background: markBg, color: markFg, borderRadius: RADIUS_SM, padding: "0 1px" }}>
        {line.slice(start, end)}
      </mark>
    );
    at = end;
  }
  out.push(line.slice(at));
  return out;
}

export function FileTreeDrawer({ repoName, onClose, linked = false, onToggleLink, allRepos, width: controlledWidth, onWidthChange, selected, onSelectFile, onPickRoot }: Props) {
  const { theme: t } = useTheme();
  const { settings } = useSettings();

  // ── Drawer resize ────────────────────────────────────────────────────────────
  const [internalWidth, setInternalWidth] = useState(controlledWidth ?? 260);
  const drawerWidth = controlledWidth ?? internalWidth;
  const drawerDragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const onDrawerResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drawerDragState.current = { startX: e.clientX, startWidth: drawerWidth };
    const onMove = (ev: MouseEvent) => {
      if (!drawerDragState.current) return;
      // Docked left, so the handle is on the trailing edge — drag right widens
      const delta = ev.clientX - drawerDragState.current.startX;
      const max = Math.max(520, window.innerWidth - 640);
      const w = Math.max(180, Math.min(max, drawerDragState.current.startWidth + delta));
      if (controlledWidth !== undefined) { onWidthChange?.(w); } else { setInternalWidth(w); }
    };
    const onUp = () => { drawerDragState.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Tree state ───────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState("");
  const [tree, setTree] = useState<Record<string, TreeEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [flatFiles, setFlatFiles] = useState<string[]>([]);
  const [flatLoading, setFlatLoading] = useState(false);
  const flatFetched = useRef<string | null>(null);
  const rootRef = useRef(repoName);
  const [grepHits, setGrepHits] = useState<GrepHit[] | null>(null);
  const [grepTotalFiles, setGrepTotalFiles] = useState(0);
  // Set when grep was stopped early or hit its deadline — a partial count must not read as exact
  const [grepPartial, setGrepPartial] = useState(false);
  const [grepTimedOut, setGrepTimedOut] = useState(false);
  const [grepLoading, setGrepLoading] = useState(false);
  const [treeHovered, setTreeHovered] = useState<string | null>(null);
  const [activeResultIdx, setActiveResultIdx] = useState(0);
  const [resultLimit, setResultLimit] = useState(RESULT_LIMIT);
  const filterRef = useRef<HTMLInputElement>(null);

  // ── Content search mode (grep) ───────────────────────────────────────────────
  const [contentMode, setContentMode] = useState(false);

  // ── Root's git branch ────────────────────────────────────────────────────────
  // Null for a non-repo root, which is why the chip is absent rather than showing a placeholder
  const [branch, setBranch] = useState<string | null>(null);
  useEffect(() => {
    setBranch(null);
    window.terminal.getRepoBranch(repoName).then((b) => {
      if (rootRef.current === repoName) setBranch(b);
    }).catch(() => {});
  }, [repoName]);

  // ── Search modifiers ────────────────────────────────────────────────────────
  // Sticky: a modifier set once usually applies to the next search too
  const [caseSensitive, setCaseSensitive] = useState(() => loadSearchMode().caseSensitive);
  const [regexMode, setRegexMode] = useState(() => loadSearchMode().regex);
  useEffect(() => {
    try { localStorage.setItem(SEARCH_MODE_KEY, JSON.stringify({ caseSensitive, regex: regexMode })); } catch { /* private mode */ }
  }, [caseSensitive, regexMode]);

  // ── Global search across all repos ──────────────────────────────────────────
  const [globalSearch, setGlobalSearch] = useState(false);
  const [allReposFiles, setAllReposFiles] = useState<Record<string, string[]>>({});
  const [allReposLoading, setAllReposLoading] = useState(false);
  const [globalGrepResults, setGlobalGrepResults] = useState<{ repo: string; file: string; hit: GrepHit }[] | null>(null);
  const [globalGrepLoading, setGlobalGrepLoading] = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const isContentSearch = contentMode;
  const contentQuery = contentMode ? filter.trim() : "";
  const isFilterMode = !contentMode && filter.trim().length > 0;
  const filteredFlat = useMemo(
    () => isFilterMode ? flatFiles.filter((f) => matchRanges(f, filter.trim(), caseSensitive, regexMode).length > 0) : [],
    [isFilterMode, flatFiles, filter, caseSensitive, regexMode]
  );
  const showList = isFilterMode || isContentSearch;

  // An unparseable pattern gets its own status line — otherwise it reads as "nothing found"
  const badPattern = useMemo(() => {
    if (!regexMode || !filter.trim()) return false;
    try { new RegExp(filter.trim()); return false; } catch { return true; }
  }, [regexMode, filter]);

  // Every result source collapses to one shape, so grouping and ↑↓ nav have a single code path
  const allResults = useMemo((): { repo: string; file: string; hit: GrepHit | null }[] => {
    if (!showList) return [];
    if (globalSearch) {
      if (isContentSearch) return (globalGrepResults ?? []).map((r) => ({ ...r, hit: r.hit as GrepHit | null }));
      const q = filter.trim();
      return Object.entries(allReposFiles).flatMap(([repo, files]) =>
        files.filter((f) => matchRanges(f, q, caseSensitive, regexMode).length > 0).map((file) => ({ repo, file, hit: null }))
      );
    }
    if (isContentSearch) return (grepHits ?? []).map((hit) => ({ repo: repoName, file: hit.file, hit }));
    return filteredFlat.map((file) => ({ repo: repoName, file, hit: null }));
  }, [showList, globalSearch, isContentSearch, globalGrepResults, grepHits, filteredFlat, filter, allReposFiles, repoName, caseSensitive, regexMode]);

  const shown = useMemo(() => allResults.slice(0, resultLimit), [allResults, resultLimit]);
  const hiddenCount = allResults.length - shown.length;

  // Total files is grep's own count — it exceeds `hits` when the preview scan was capped
  const totalFiles = isContentSearch && !globalSearch ? Math.max(grepTotalFiles, allResults.length) : allResults.length;
  const totalMatches = useMemo(() => shown.reduce((n, r) => n + (r.hit?.count ?? 0), 0), [shown]);

  const basenameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    shown.forEach(({ file }) => {
      const base = file.split("/").pop() ?? file;
      counts.set(base, (counts.get(base) ?? 0) + 1);
    });
    return counts;
  }, [shown]);

  // Folder group headers carry location, so the rows themselves need no path.
  // Rows keep their flat index so ↑↓ nav and the grouped render order stay in step.
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: (typeof shown[number] & { idx: number })[] }[] = [];
    const index = new Map<string, number>();
    shown.forEach((r, idx) => {
      const dir = r.file.split("/").slice(0, -1).join("/");
      const key = globalSearch ? `${r.repo}\u0000${dir}` : dir;
      let at = index.get(key);
      if (at === undefined) {
        at = out.length;
        index.set(key, at);
        const label = globalSearch ? [r.repo, dir].filter(Boolean).join(" · ") : (dir || "root");
        out.push({ key, label, items: [] });
      }
      out[at].items.push({ ...r, idx });
    });
    return out;
  }, [shown, globalSearch]);

  // ── Effects ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    setFilter(""); setContentMode(false); setTree({}); setFlatFiles([]);
    setGrepHits(null); setGlobalGrepResults(null); flatFetched.current = null;
    rootRef.current = repoName;

    // Restore this root's expansion — each open dir needs its children fetched before it can render
    const remembered = loadRoot(repoName).expanded;
    setExpanded(new Set(remembered));
    Promise.all(["", ...remembered].map((d) =>
      window.terminal.listDir(repoName, d).then((entries) => [d, entries] as const).catch(() => [d, []] as const)
    )).then((pairs) => {
      if (rootRef.current !== repoName) return;
      setTree(Object.fromEntries(pairs));
    });
    setTimeout(() => filterRef.current?.focus(), 50);
  }, [repoName]);

  // The recursive walk is cheap per repo but costly at $HOME — defer it until a filter is typed
  useEffect(() => {
    if (!isFilterMode || flatFetched.current === repoName) return;
    flatFetched.current = repoName;
    setFlatLoading(true);
    window.terminal.listFiles(repoName)
      .catch(() => [] as string[])
      .then((files) => {
        if (flatFetched.current !== repoName) return;
        setFlatFiles(files); setFlatLoading(false);
      });
  }, [isFilterMode, repoName]);

  useEffect(() => {
    if (!contentQuery) { setGrepHits(null); setGrepTotalFiles(0); setGrepPartial(false); setGrepTimedOut(false); return; }
    setGrepLoading(true);
    const timer = setTimeout(() => {
      window.terminal.grepMatches(repoName, contentQuery, RESULT_LIMIT, { caseSensitive, regex: regexMode })
        .then(({ hits, totalFiles: n, truncated, timedOut }) => {
          setGrepHits(hits); setGrepTotalFiles(n);
          setGrepPartial(!!truncated || !!timedOut); setGrepTimedOut(!!timedOut);
          setGrepLoading(false);
        })
        .catch(() => { setGrepHits([]); setGrepTotalFiles(0); setGrepPartial(false); setGrepTimedOut(false); setGrepLoading(false); });
    }, 400);
    return () => clearTimeout(timer);
  }, [contentQuery, repoName, caseSensitive, regexMode]);

  useEffect(() => { setActiveResultIdx(0); setResultLimit(RESULT_LIMIT); }, [filter, caseSensitive, regexMode]);
  useEffect(() => { setActiveResultIdx(0); }, [grepHits]);

  // Load file lists for all repos when global search is first enabled
  useEffect(() => {
    if (!globalSearch || !allRepos?.length) return;
    const missing = allRepos.filter((r) => !allReposFiles[r]);
    if (missing.length === 0) return;
    setAllReposLoading(true);
    Promise.all(missing.map((r) => window.terminal.listFiles(r).then((files) => ({ repo: r, files })).catch(() => ({ repo: r, files: [] as string[] }))))
      .then((results) => {
        setAllReposFiles((prev) => {
          const next = { ...prev };
          results.forEach(({ repo, files }) => { next[repo] = files; });
          return next;
        });
        setAllReposLoading(false);
      });
  }, [globalSearch, allRepos]);

  // Global grep with debounce
  useEffect(() => {
    if (!globalSearch || !contentQuery || !allRepos?.length) { setGlobalGrepResults(null); return; }
    setGlobalGrepLoading(true);
    const timer = setTimeout(() => {
      // Capped per repo — 39 repos × an uncapped scan would swamp the render cap anyway
      Promise.all(
        allRepos.map((r) => window.terminal.grepMatches(r, contentQuery, 10, { caseSensitive, regex: regexMode })
          .then(({ hits }) => hits.map((hit) => ({ repo: r, file: hit.file, hit })))
          .catch(() => [] as { repo: string; file: string; hit: GrepHit }[]))
      ).then((results) => { setGlobalGrepResults(results.flat()); setGlobalGrepLoading(false); });
    }, 400);
    return () => clearTimeout(timer);
  }, [contentQuery, globalSearch, allRepos, caseSensitive, regexMode]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const toggleDir = async (path: string) => {
    const isOpen = expanded.has(path);
    const next = new Set(expanded);
    isOpen ? next.delete(path) : next.add(path);
    setExpanded(next);
    saveRoot(repoName, { expanded: [...next] });
    if (!isOpen && !tree[path]) {
      const entries = await window.terminal.listDir(repoName, path);
      if (rootRef.current !== repoName) return;
      setTree((prev) => ({ ...prev, [path]: entries }));
    }
  };

  const isSelected = (path: string, repo = repoName) => selected?.path === path && selected?.repo === repo;

  const statusLine: CSSProperties = { padding: "8px 12px", color: t.label4, fontSize: 11, ...MONO_FONT };

  const modeToggle = (on: boolean): CSSProperties => ({
    flex: "none", border: `1px solid ${t.borderMid}`, borderRadius: RADIUS_SM,
    cursor: "pointer", padding: "0 6px", height: 20, fontSize: 10, letterSpacing: 0.2,
    fontWeight: on ? 600 : 400,
    color: on ? t.label1 : t.label3,
    background: on ? t.selectedBg : "transparent",
    transition: TRANSITION,
  });

  // Escalate past the render cap — refetches so the extra files get previews too
  const showAllResults = () => {
    setResultLimit(Number.MAX_SAFE_INTEGER);
    if (!contentQuery || globalSearch) return;
    setGrepLoading(true);
    window.terminal.grepMatches(repoName, contentQuery, 400, { caseSensitive, regex: regexMode })
      .then(({ hits, totalFiles: n, truncated, timedOut }) => {
        setGrepHits(hits); setGrepTotalFiles(n);
        setGrepPartial(!!truncated || !!timedOut); setGrepTimedOut(!!timedOut);
        setGrepLoading(false);
      })
      .catch(() => setGrepLoading(false));
  };

  // ── Tree renderer ─────────────────────────────────────────────────────────────
  const renderTree = (parentPath: string, depth: number): React.ReactNode => {
    const entries = tree[parentPath];
    if (!entries) return null;
    return entries.map((entry) => {
      const isOpen = expanded.has(entry.path);
      const sel = !entry.isDir && isSelected(entry.path);
      const hovKey = `t:${entry.path}`;
      return (
        <div key={entry.path}>
          <div
            onClick={() => entry.isDir ? toggleDir(entry.path) : onSelectFile({ repo: repoName, path: entry.path })}
            onMouseEnter={() => setTreeHovered(hovKey)}
            onMouseLeave={() => setTreeHovered(null)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: `4px 10px 4px ${10 + depth * 14}px`,
              cursor: "pointer", userSelect: "none" as const,
              ...rowState(t, sel, treeHovered === hovKey),
            }}
          >
            {entry.isDir ? (
              <span style={{ color: t.label4, fontSize: 9, width: 9, flexShrink: 0 }}>
                {isOpen ? "▾" : "▸"}
              </span>
            ) : (
              <span style={{ color: t.label4, fontSize: 8, width: 16, flexShrink: 0, ...MONO_FONT }}>{"</>"}</span>
            )}
            <span style={{
              color: entry.isDir ? t.label2 : (sel ? t.label1 : t.label2),
              fontSize: 13, lineHeight: "18px", fontWeight: sel ? 600 : 400,
              ...SYS_FONT, ...CLIP,
            }}>
              {entry.name}
            </span>
          </div>
          {entry.isDir && isOpen && renderTree(entry.path, depth + 1)}
        </div>
      );
    });
  };

  const rootLabel = repoName.startsWith("/") ? (repoName.split("/").filter(Boolean).pop() ?? "/") : repoName;

  return (
    <div
      style={{
        width: drawerWidth, minWidth: 180, flexShrink: 0,
        background: t.surface1, borderRight: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column", position: "relative",
      }}
    >
      {/* Right resize handle */}
      <div
        onMouseDown={onDrawerResizeDown}
        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 10 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = `${t.blue}40`; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      />

      {/* Header */}
      <div style={panelHeader(t)}>
        <span
          style={{ ...panelTitle(t), ...CLIP, flex: 1 }}
          data-tooltip={showList ? undefined : repoName}
          data-tooltip-pos="below"
        >{showList ? "Search" : rootLabel}</span>
        {showList && totalFiles > 0 && (
          <span style={{ ...chipStyle(t, "accent"), flex: "none" }}>{totalFiles}{isContentSearch && grepPartial ? "+" : ""} files</span>
        )}
        {/* One chip slot: the file count owns it while searching — 260px holds one chip, not two */}
        {!showList && branch && (
          <span style={{ ...chipStyle(t), ...CLIP }} data-tooltip={`On branch ${branch}`} data-tooltip-pos="below">⟳ {branch}</span>
        )}
        {allRepos && allRepos.length > 1 && (
          <button
            onClick={() => setGlobalSearch((v) => !v)}
            data-tooltip={globalSearch ? "Searching every repo — click for this one only" : "Search every repo"}
            data-tooltip-pos="below"
            aria-pressed={globalSearch}
            style={{ ...iconBtn, color: globalSearch ? t.blue : t.label3 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z"/></svg>
          </button>
        )}
        {onPickRoot && (
          <button
            onClick={onPickRoot}
            data-tooltip="Browse another folder"
            data-tooltip-pos="below"
            style={{ ...iconBtn, color: t.label3 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; e.currentTarget.style.color = t.label1; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.label3; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>
          </button>
        )}
        {onToggleLink && (
          <button
            onClick={onToggleLink}
            data-tooltip={linked ? "Linked to active session — click to lock" : "Click to link to active session"}
            data-tooltip-pos="below"
            style={{ ...iconBtn, fontSize: 13, color: linked ? t.blue : t.label3 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
          >⇄</button>
        )}
      </div>

      {/* Query field */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        margin: "8px 10px 0", padding: "0 6px 0 8px", height: 26,
        background: t.surface0, border: `1px solid ${t.borderMid}`,
        borderRadius: RADIUS, flexShrink: 0,
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={t.label4} strokeWidth="2" strokeLinecap="round" style={{ flex: "none" }}><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/></svg>
        <input
          ref={filterRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { filter ? setFilter("") : onClose(); return; }
            if (!showList) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveResultIdx((i) => Math.min(i + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveResultIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const item = shown[activeResultIdx];
              if (item) onSelectFile({ repo: item.repo, path: item.file, line: item.hit?.line, match: item.hit ? contentQuery : undefined });
            }
          }}
          placeholder={contentMode ? "Search in file contents…" : "Search filenames…"}
          style={{
            flex: 1, minWidth: 0, background: "none", border: "none", outline: "none",
            color: t.label1, fontSize: 12, ...MONO_FONT,
          }}
        />
        {filter && (
          <button
            onClick={() => setFilter("")}
            aria-label="Clear query"
            style={{ ...iconBtn, width: 16, height: 16, fontSize: 13, color: t.label3 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
          >×</button>
        )}
      </div>

      {/* Control row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 8px", flexShrink: 0 }}>
        <div style={{ display: "flex", flex: "none", border: `1px solid ${t.borderMid}`, borderRadius: RADIUS_SM, overflow: "hidden" }}>
          {([["In files", true], ["Filenames", false]] as const).map(([label, wantsContent], i) => (
            <button
              key={label}
              onClick={() => { if (contentMode !== wantsContent) { setContentMode(wantsContent); setFilter(""); } }}
              aria-pressed={contentMode === wantsContent}
              style={{
                border: "none", cursor: "pointer", padding: "0 7px", height: 20,
                borderLeft: i > 0 ? `1px solid ${t.borderMid}` : "none",
                fontSize: 10, letterSpacing: 0.2,
                fontWeight: contentMode === wantsContent ? 600 : 400,
                color: contentMode === wantsContent ? t.label1 : t.label3,
                background: contentMode === wantsContent ? t.selectedBg : "transparent",
                transition: TRANSITION, ...SYS_FONT,
              }}
            >{label}</button>
          ))}
        </div>
        <button
          onClick={() => setCaseSensitive((v) => !v)}
          data-tooltip={caseSensitive ? "Case sensitive" : "Ignoring case"}
          aria-pressed={caseSensitive}
          style={{ ...modeToggle(caseSensitive), ...SYS_FONT }}
        >Aa</button>
        <button
          onClick={() => setRegexMode((v) => !v)}
          data-tooltip={regexMode ? "Regular expression" : "Plain text"}
          aria-pressed={regexMode}
          style={{
            ...modeToggle(regexMode), ...MONO_FONT,
            color: badPattern ? t.red : regexMode ? t.label1 : t.label3,
          }}
        >.*</button>
        <span style={{ flex: 1, minWidth: 0 }} />
        {showList && totalMatches > 0 && (
          <span style={{ flex: "none", fontSize: 11, color: t.label3, ...MONO_FONT, ...TABULAR }}>
            {totalMatches}{hiddenCount > 0 ? "+" : ""} matches
          </span>
        )}
      </div>

      {/* Tree / grouped results */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 4 }} onMouseLeave={() => setTreeHovered(null)}>
        {showList ? (
          <>
            {(isContentSearch && (globalSearch ? globalGrepLoading : grepLoading)) && (
              <div style={statusLine}>Searching…</div>
            )}
            {globalSearch && allReposLoading && !isContentSearch && (
              <div style={statusLine}>Loading repos…</div>
            )}
            {isFilterMode && flatLoading && !globalSearch && (
              <div style={statusLine}>Indexing files…</div>
            )}
            {badPattern ? (
              <div style={{ ...statusLine, color: t.red }}>Invalid pattern.</div>
            ) : !grepLoading && !flatLoading && !allReposLoading && allResults.length === 0 && (
              <div style={{ ...statusLine, ...(grepTimedOut ? { color: t.orange } : {}) }}>
                {grepTimedOut ? "Search gave up — this root is too large. Pick a repo." : "No files match."}
              </div>
            )}

            {groups.map((group) => (
              <div key={group.key}>
                <div style={{ ...sectionLabel(t, true), ...CLIP_LEFT }} title={group.label}>{group.label}</div>
                {group.items.map(({ idx, ...r }) => {
                  const fileName = r.file.split("/").pop() ?? r.file;
                  const sel = isSelected(r.file, r.repo);
                  const isActive = idx === activeResultIdx;
                  const env = (basenameCounts.get(fileName) ?? 0) > 1 ? envChip(r.file) : null;
                  return (
                    <div
                      key={`${r.repo}:${r.file}`}
                      onClick={() => { onSelectFile({ repo: r.repo, path: r.file, line: r.hit?.line, match: r.hit ? contentQuery : undefined }); setActiveResultIdx(idx); }}
                      onMouseEnter={() => setActiveResultIdx(idx)}
                      style={{ padding: "7px 10px 8px 12px", cursor: "pointer", ...rowState(t, sel, isActive) }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{
                          flex: "0 1 auto", fontSize: 12, lineHeight: "17px",
                          color: sel ? t.label1 : t.label2,
                          fontWeight: sel ? 600 : 400, ...MONO_FONT, ...CLIP,
                        }}>{fileName}</span>
                        <span style={{ flex: 1, minWidth: 0 }} />
                        {env && (
                          <span style={{
                            flex: "none", fontSize: 10, fontWeight: 600, padding: "0 4px",
                            borderRadius: RADIUS_SM, background: `${env.color}22`, color: env.color,
                            border: `1px solid ${env.color}44`, ...MONO_FONT,
                          }}>{env.label}</span>
                        )}
                        {r.hit && (
                          <span style={{ flex: "none", fontSize: 10, color: t.label3, ...MONO_FONT, ...TABULAR }}>{r.hit.count}</span>
                        )}
                      </div>
                      {r.hit && settings.showMatchPreview && (
                        <div style={{
                          fontSize: 11, lineHeight: "16px", marginTop: 2,
                          color: t.label3, ...MONO_FONT, ...CLIP,
                        }}>{highlight(r.hit.preview, matchRanges(r.hit.preview, contentQuery, caseSensitive, regexMode), t.matchBg, t.label1)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {hiddenCount > 0 && (
              <button
                onClick={showAllResults}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "8px 12px", background: "none", border: "none", cursor: "pointer",
                  fontSize: 11, color: t.label3, transition: TRANSITION, ...SYS_FONT, ...TABULAR,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = t.surface2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >{hiddenCount}{isContentSearch && grepPartial ? "+" : ""} more files · <span style={{ color: t.blue }}>show all</span></button>
            )}
          </>
        ) : (
          !tree[""]
            ? <div style={statusLine}>Loading…</div>
            : renderTree("", 0)
        )}
      </div>

      {/* Keyboard nav hint */}
      {showList && shown.length > 0 && (
        <div style={{
          padding: "0 10px", height: 22, borderTop: `1px solid ${t.borderMid}`, flexShrink: 0,
          color: t.label4, fontSize: 10, ...MONO_FONT,
          display: "flex", alignItems: "center", gap: 14,
        }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      )}
    </div>
  );
}
