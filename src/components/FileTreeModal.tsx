import { useState, useEffect, useRef, useMemo } from "react";
import { useTheme } from "../ThemeContext";
import hljs from "highlight.js";
import "highlight.js/styles/atom-one-dark.css";

interface TreeEntry { name: string; isDir: boolean; path: string; }
interface FileView { repo: string; path: string; content: string; highlightedHtml: string; }
interface Props { repoName: string; onClose: () => void; linked?: boolean; onToggleLink?: () => void; allRepos?: string[]; width?: number; onWidthChange?: (w: number) => void; }

function detectLang(filePath: string): string {
  const name = filePath.split("/").pop()?.toLowerCase() ?? "";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "jenkinsfile") return "groovy";
  if (name === "makefile") return "makefile";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    kt: "kotlin", kts: "kotlin", java: "java", py: "python",
    sh: "bash", bash: "bash", zsh: "bash",
    yml: "yaml", yaml: "yaml", json: "json",
    md: "markdown", xml: "xml", html: "html", css: "css",
    gradle: "groovy", go: "go", rs: "rust", scala: "scala",
    sql: "sql", tf: "hcl", rb: "ruby", swift: "swift",
    properties: "ini", toml: "ini",
  };
  return map[ext] ?? "plaintext";
}

function doHighlight(content: string, filePath: string): string {
  const lang = detectLang(filePath);
  try {
    if (lang !== "plaintext" && hljs.getLanguage(lang)) {
      return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
    }
  } catch {}
  return hljs.highlightAuto(content).value;
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

function shortenPath(filePath: string): string {
  const parts = filePath.split("/");
  return parts.length <= 3 ? filePath : `…/${parts.slice(-3).join("/")}`;
}

// Inject <mark> around query occurrences in hljs HTML, operating only on text nodes.
function injectMark(html: string, query: string): string {
  if (!query) return html;
  const q = query.toLowerCase();
  const parts = html.split(/(<[^>]+>)/);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part; // HTML tag — pass through
    const lower = part.toLowerCase();
    let result = "";
    let pos = 0;
    let found = lower.indexOf(q, pos);
    while (found !== -1) {
      result += part.slice(pos, found);
      result += `<mark style="background:rgba(255,180,0,0.4);color:inherit;border-radius:2px;padding:0">${part.slice(found, found + q.length)}</mark>`;
      pos = found + q.length;
      found = lower.indexOf(q, pos);
    }
    return result + part.slice(pos);
  }).join("");
}

export function FileTreeDrawer({ repoName, onClose, linked = false, onToggleLink, allRepos, width: controlledWidth, onWidthChange }: Props) {
  const { theme: t } = useTheme();

  // ── Drawer resize ────────────────────────────────────────────────────────────
  const [internalWidth, setInternalWidth] = useState(controlledWidth ?? 320);
  const drawerWidth = controlledWidth ?? internalWidth;
  const drawerDragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const onDrawerResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drawerDragState.current = { startX: e.clientX, startWidth: drawerWidth };
    const onMove = (ev: MouseEvent) => {
      if (!drawerDragState.current) return;
      const delta = drawerDragState.current.startX - ev.clientX;
      const w = Math.max(220, Math.min(650, drawerDragState.current.startWidth + delta));
      if (controlledWidth !== undefined) { onWidthChange?.(w); } else { setInternalWidth(w); }
    };
    const onUp = () => { drawerDragState.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Vertical split ───────────────────────────────────────────────────────────
  const [treeHeight, setTreeHeight] = useState(260);
  const splitDragState = useRef<{ startY: number; startHeight: number } | null>(null);
  const onSplitDown = (e: React.MouseEvent) => {
    e.preventDefault();
    splitDragState.current = { startY: e.clientY, startHeight: treeHeight };
    const onMove = (ev: MouseEvent) => {
      if (!splitDragState.current) return;
      const delta = ev.clientY - splitDragState.current.startY;
      setTreeHeight(Math.max(80, Math.min(520, splitDragState.current.startHeight + delta)));
    };
    const onUp = () => { splitDragState.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Tree state ───────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState("");
  const [tree, setTree] = useState<Record<string, TreeEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [flatFiles, setFlatFiles] = useState<string[]>([]);
  const [grepResults, setGrepResults] = useState<string[] | null>(null);
  const [grepLoading, setGrepLoading] = useState(false);
  const [treeHovered, setTreeHovered] = useState<string | null>(null);
  const [activeResultIdx, setActiveResultIdx] = useState(0);
  const filterRef = useRef<HTMLInputElement>(null);

  // ── File viewer state ────────────────────────────────────────────────────────
  const [fileView, setFileView] = useState<FileView | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);

  // ── Find-in-file ─────────────────────────────────────────────────────────────
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIdx, setFindIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const codeViewRef = useRef<HTMLDivElement>(null);

  // ── Open-in dropdown ─────────────────────────────────────────────────────────
  const [showOpenMenu, setShowOpenMenu] = useState(false);
  const openMenuRef = useRef<HTMLDivElement>(null);

  // ── Button hover for text-on-hover ──────────────────────────────────────────
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  // ── Content search mode (grep) ───────────────────────────────────────────────
  const [contentMode, setContentMode] = useState(false);

  // ── Global search across all repos ──────────────────────────────────────────
  const [globalSearch, setGlobalSearch] = useState(false);
  const [allReposFiles, setAllReposFiles] = useState<Record<string, string[]>>({});
  const [allReposLoading, setAllReposLoading] = useState(false);
  const [globalGrepResults, setGlobalGrepResults] = useState<{ repo: string; file: string }[] | null>(null);
  const [globalGrepLoading, setGlobalGrepLoading] = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const lines = useMemo(() => fileView?.content.split("\n") ?? [], [fileView]);
  const htmlLines = useMemo(() => fileView?.highlightedHtml.split("\n") ?? [], [fileView]);

  const findQ = findQuery.toLowerCase();
  const matchingLines = useMemo(() => {
    if (!findQ || !fileView) return [];
    return lines.reduce<number[]>((acc, line, i) => {
      if (line.toLowerCase().includes(findQ)) acc.push(i);
      return acc;
    }, []);
  }, [findQ, lines, fileView]);

  const isContentSearch = contentMode;
  const contentQuery = contentMode ? filter.trim() : "";
  const isFilterMode = !contentMode && filter.trim().length > 0;
  const filteredFlat = useMemo(
    () => isFilterMode ? flatFiles.filter((f) => f.toLowerCase().includes(filter.toLowerCase())) : [],
    [isFilterMode, flatFiles, filter]
  );
  const showList = isFilterMode || isContentSearch;
  const listItems = isContentSearch ? (grepResults ?? []) : filteredFlat;

  const basenameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    listItems.forEach((p) => {
      const base = p.split("/").pop() ?? p;
      counts.set(base, (counts.get(base) ?? 0) + 1);
    });
    return counts;
  }, [listItems]);

  // Global search results (cross-repo)
  const globalItems = useMemo((): { repo: string; file: string }[] | null => {
    if (!globalSearch || !showList) return null;
    if (isContentSearch) return globalGrepResults;
    if (!filter.trim()) return null;
    const q = filter.toLowerCase();
    return Object.entries(allReposFiles).flatMap(([repo, files]) =>
      files.filter((f) => f.toLowerCase().includes(q)).map((file) => ({ repo, file }))
    );
  }, [globalSearch, showList, isContentSearch, globalGrepResults, filter, allReposFiles]);

  // ── Effects ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    setFilter(""); setContentMode(false); setTree({}); setExpanded(new Set()); setFlatFiles([]);
    setGrepResults(null); setGlobalGrepResults(null); setFileView(null); setShowFind(false); setFindQuery("");
    window.terminal.listDir(repoName, "").then((entries) => setTree({ "": entries }));
    window.terminal.listFiles(repoName).then(setFlatFiles);
    setTimeout(() => filterRef.current?.focus(), 50);
  }, [repoName]);

  useEffect(() => {
    if (!contentQuery) { setGrepResults(null); return; }
    setGrepLoading(true);
    const timer = setTimeout(() => {
      window.terminal.grepFiles(repoName, contentQuery)
        .then((files) => { setGrepResults(files); setGrepLoading(false); })
        .catch(() => { setGrepResults([]); setGrepLoading(false); });
    }, 400);
    return () => clearTimeout(timer);
  }, [contentQuery, repoName]);

  useEffect(() => { setActiveResultIdx(0); }, [filter, grepResults]);

  useEffect(() => {
    if (!codeViewRef.current || matchingLines.length === 0) return;
    const safeIdx = ((findIdx % matchingLines.length) + matchingLines.length) % matchingLines.length;
    codeViewRef.current.querySelectorAll("tr")[matchingLines[safeIdx]]?.scrollIntoView({ block: "center" });
  }, [findIdx, matchingLines]);

  useEffect(() => {
    if (!showOpenMenu) return;
    const handler = (e: MouseEvent) => {
      if (openMenuRef.current?.contains(e.target as Node)) return;
      setShowOpenMenu(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [showOpenMenu]);

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
      Promise.all(
        allRepos.map((r) => window.terminal.grepFiles(r, contentQuery).then((files) => files.map((file) => ({ repo: r, file }))).catch(() => [] as { repo: string; file: string }[]))
      ).then((results) => { setGlobalGrepResults(results.flat()); setGlobalGrepLoading(false); });
    }, 400);
    return () => clearTimeout(timer);
  }, [contentQuery, globalSearch, allRepos]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const toggleDir = async (path: string) => {
    const isOpen = expanded.has(path);
    setExpanded((prev) => { const n = new Set(prev); isOpen ? n.delete(path) : n.add(path); return n; });
    if (!isOpen && !tree[path]) {
      const entries = await window.terminal.listDir(repoName, path);
      setTree((prev) => ({ ...prev, [path]: entries }));
    }
  };

  const selectFile = async (path: string, repo = repoName) => {
    setFileLoading(true);
    const content = await window.terminal.readRepoFile(repo, path).catch(() => "");
    setFileView({ repo, path, content, highlightedHtml: doHighlight(content, path) });
    setFileLoading(false);
    setShowFind(false);
    setFindQuery("");
  };

  const openFind = () => {
    setShowFind(true);
    setTimeout(() => findInputRef.current?.focus(), 50);
  };

  const hoverBg = t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
  const activeBg = t.isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.07)";

  // ── Tree renderer ─────────────────────────────────────────────────────────────
  const renderTree = (parentPath: string, depth: number): React.ReactNode => {
    const entries = tree[parentPath];
    if (!entries) return null;
    return entries.map((entry) => {
      const isOpen = expanded.has(entry.path);
      const isSelected = fileView?.path === entry.path;
      const hovKey = `t:${entry.path}`;
      return (
        <div key={entry.path}>
          <div
            onClick={() => entry.isDir ? toggleDir(entry.path) : selectFile(entry.path)}
            onMouseEnter={() => setTreeHovered(hovKey)}
            onMouseLeave={() => setTreeHovered(null)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: `4px 10px 4px ${10 + depth * 14}px`,
              cursor: "pointer", userSelect: "none" as const,
              background: isSelected ? activeBg : treeHovered === hovKey ? hoverBg : "transparent",
              borderLeft: `2px solid ${isSelected ? t.blue : "transparent"}`,
            }}
          >
            {entry.isDir ? (
              <span style={{ color: t.label4, fontSize: 9, width: 9, flexShrink: 0 }}>
                {isOpen ? "▾" : "▸"}
              </span>
            ) : (
              <span style={{ color: t.label4, fontSize: 8, width: 16, flexShrink: 0, fontFamily: "monospace" }}>{"</>"}</span>
            )}
            <span style={{
              color: entry.isDir ? t.label2 : (isSelected ? t.label1 : t.label2), fontSize: 12,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
            }}>
              {entry.name}
            </span>
          </div>
          {entry.isDir && isOpen && renderTree(entry.path, depth + 1)}
        </div>
      );
    });
  };

  const resultCount = globalItems ? globalItems.length : listItems.length;
  const headerLabel = showList
    ? `Results${globalSearch ? " · all repos" : ""}${resultCount ? ` (${resultCount})` : "…"}`
    : "Files";

  // Find: current match index normalized
  const findTotal = matchingLines.length;
  const findCurrent = findTotal > 0 ? ((findIdx % findTotal) + findTotal) % findTotal : 0;

  const btnStyle = (key: string, active = false): React.CSSProperties => ({
    background: active ? `${t.blue}20` : "none",
    border: `1px solid ${active ? t.blue + "50" : "transparent"}`,
    borderRadius: 5, cursor: "pointer",
    color: active ? t.blue : hoveredBtn === key ? t.label1 : t.label4,
    padding: 0, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 26, height: 26,
    transition: "color 0.1s, background 0.1s",
  });

  return (
    <div
      style={{
        width: drawerWidth, minWidth: 220, flexShrink: 0,
        background: t.surface1, borderLeft: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column", position: "relative",
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "f" && fileView) {
          e.preventDefault(); e.stopPropagation(); openFind();
        }
      }}
    >
      {/* Left resize handle */}
      <div
        onMouseDown={onDrawerResizeDown}
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 10 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = `${t.blue}40`; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      />

      {/* ── TOP: File tree ─────────────────────────────────────────────────── */}
      <div style={{
        height: treeHeight, minHeight: 80, flexShrink: 0,
        display: "flex", flexDirection: "column",
        borderBottom: `1px solid ${t.border}`,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", padding: "8px 12px 6px", flexShrink: 0 }}>
          <span style={{ flex: 1, color: t.label1, fontWeight: 700, fontSize: 13 }}>{headerLabel}</span>
          {onToggleLink && (
            <button
              onClick={onToggleLink}
              data-tooltip={linked ? "Linked to active session — click to lock" : "Click to link to active session"}
              data-tooltip-pos="below"
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 4px", color: linked ? t.blue : t.label4 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = linked ? t.label1 : t.blue; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = linked ? t.blue : t.label4; }}
            >⇄</button>
          )}
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 14, lineHeight: 1, padding: "0 2px" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
          >×</button>
        </div>

        {/* Filter */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          margin: "0 8px 4px", padding: "4px 8px",
          background: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
          border: `1px solid ${t.borderSubtle}`, borderRadius: 6, flexShrink: 0,
        }}>
          <span style={{ color: t.label4, fontSize: 11 }}>⌕</span>
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { filter ? setFilter("") : onClose(); return; }
              if (!showList) return;
              const navLen = globalItems ? globalItems.length : listItems.length;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveResultIdx((i) => Math.min(i + 1, navLen - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveResultIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (globalItems) {
                  const item = globalItems[activeResultIdx];
                  if (item) selectFile(item.file, item.repo);
                } else if (listItems[activeResultIdx]) {
                  selectFile(listItems[activeResultIdx]);
                }
              }
            }}
            placeholder={contentMode ? "Search in file contents…" : "Filter files…"}
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: t.label1, fontSize: 11,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
            }}
          />
          {filter && (
            <button onClick={() => setFilter("")} style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
          )}
          <button
            onClick={() => { setContentMode((v) => !v); setFilter(""); }}
            data-tooltip={contentMode ? "Switch to filename filter" : "Search inside file contents"}
            style={{
              background: contentMode ? `${t.blue}25` : "none",
              border: `1px solid ${contentMode ? t.blue + "60" : t.borderSubtle}`,
              color: contentMode ? t.blue : t.label4,
              borderRadius: 4, cursor: "pointer", fontSize: 9, padding: "1px 5px",
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
              flexShrink: 0, fontWeight: contentMode ? 700 : 400,
            }}
          >in files</button>
          {allRepos && allRepos.length > 1 && (
            <button
              onClick={() => setGlobalSearch((v) => !v)}
              data-tooltip={globalSearch ? "Search this repo only" : "Search all repos"}
              style={{
                background: globalSearch ? `${t.blue}25` : "none",
                border: `1px solid ${globalSearch ? t.blue + "60" : t.borderSubtle}`,
                color: globalSearch ? t.blue : t.label4,
                borderRadius: 4, cursor: "pointer", fontSize: 9, padding: "1px 5px",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
                flexShrink: 0, fontWeight: globalSearch ? 700 : 400,
              }}
            >All</button>
          )}
        </div>

        {/* Tree / flat list */}
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 4 }} onMouseLeave={() => setTreeHovered(null)}>
          {showList ? (
            <>
              {(isContentSearch && (globalSearch ? globalGrepLoading : grepLoading)) && (
                <div style={{ padding: "8px 12px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>Searching…</div>
              )}
              {globalSearch && allReposLoading && !isContentSearch && (
                <div style={{ padding: "8px 12px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>Loading repos…</div>
              )}
              {/* Global results */}
              {globalItems !== null && globalItems.map(({ repo, file }, idx) => {
                const parts = file.split("/");
                const fileName = parts.at(-1) ?? file;
                const dir = parts.slice(0, -1).join("/");
                const isSelected = fileView?.path === file && fileView?.repo === repo;
                const isActive = idx === activeResultIdx;
                return (
                  <div
                    key={`${repo}:${file}`}
                    onClick={() => { selectFile(file, repo); setActiveResultIdx(idx); }}
                    onMouseEnter={() => setActiveResultIdx(idx)}
                    style={{
                      display: "flex", alignItems: "center", gap: 7, padding: "4px 10px 4px 12px",
                      cursor: "pointer",
                      background: isSelected ? activeBg : isActive ? hoverBg : "transparent",
                      borderLeft: `2px solid ${isSelected ? t.blue : "transparent"}`,
                    }}
                  >
                    <span style={{ color: t.label4, fontSize: 8, width: 16, flexShrink: 0, fontFamily: "monospace" }}>{"</>"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: isSelected ? t.label1 : t.label2, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</div>
                      <div style={{ color: t.label4, fontSize: 9, fontFamily: "monospace", marginTop: 1 }}>{dir ? `${dir}/` : ""}</div>
                    </div>
                    <span style={{
                      fontSize: 9, padding: "1px 5px", borderRadius: 3,
                      background: `${t.blue}18`, color: t.blue,
                      border: `1px solid ${t.blue}30`,
                      fontFamily: "monospace", flexShrink: 0, maxWidth: 80,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{repo}</span>
                  </div>
                );
              })}
              {/* Local results */}
              {globalItems === null && !grepLoading && listItems.length === 0 && (filter.trim() || contentQuery) && (
                <div style={{ padding: "8px 12px", color: t.label4, fontSize: 11 }}>No files match.</div>
              )}
              {globalItems === null && !grepLoading && listItems.map((filePath, idx) => {
                const parts = filePath.split("/");
                const fileName = parts.at(-1) ?? filePath;
                const dir = parts.slice(0, -1).join("/");
                const isSelected = fileView?.path === filePath;
                const isActive = idx === activeResultIdx;
                const chip = (basenameCounts.get(fileName) ?? 0) > 1 ? envChip(filePath) : null;
                return (
                  <div
                    key={filePath}
                    onClick={() => { selectFile(filePath); setActiveResultIdx(idx); }}
                    onMouseEnter={() => setActiveResultIdx(idx)}
                    style={{
                      display: "flex", alignItems: "center", gap: 7, padding: "4px 10px 4px 12px",
                      cursor: "pointer",
                      background: isSelected ? activeBg : isActive ? hoverBg : "transparent",
                      borderLeft: `2px solid ${isSelected ? t.blue : "transparent"}`,
                    }}
                  >
                    <span style={{ color: t.label4, fontSize: 8, width: 16, flexShrink: 0, fontFamily: "monospace" }}>{"</>"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: isSelected ? t.label1 : t.label2, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</div>
                      {dir && <div style={{ color: t.label4, fontSize: 9, fontFamily: "monospace", marginTop: 1 }}>{dir}/</div>}
                    </div>
                    {chip && (
                      <span style={{
                        fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
                        background: `${chip.color}22`, color: chip.color,
                        border: `1px solid ${chip.color}44`,
                        fontFamily: "monospace", flexShrink: 0,
                      }}>{chip.label}</span>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            !tree[""]
              ? <div style={{ padding: "10px 10px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>Loading…</div>
              : renderTree("", 0)
          )}
        </div>

        {/* Keyboard nav hint */}
        {showList && (globalItems ? globalItems.length : listItems.length) > 0 && (
          <div style={{
            padding: "4px 10px", borderTop: `1px solid ${t.borderSubtle}`, flexShrink: 0,
            color: t.label4, fontSize: 9, fontFamily: "monospace",
            display: "flex", gap: 8,
          }}>
            <span>↑↓ navigate</span>
            <span>·</span>
            <span>↵ open</span>
            <span>·</span>
            <span>Esc close</span>
          </div>
        )}
      </div>

      {/* ── Vertical drag handle ──────────────────────────────────────────── */}
      <div
        onMouseDown={onSplitDown}
        style={{ height: 5, cursor: "row-resize", flexShrink: 0, background: "transparent", zIndex: 5 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = `${t.blue}40`; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      />

      {/* ── BOTTOM: File viewer ───────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {!fileView && !fileLoading && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: t.label4, fontSize: 11 }}>Select a file to view</span>
          </div>
        )}

        {fileLoading && (
          <div style={{ padding: "12px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>Loading…</div>
        )}

        {fileView && !fileLoading && (
          <>
            {/* Path bar */}
            <div style={{
              display: "flex", alignItems: "center", gap: 4, padding: "5px 8px 5px 10px",
              borderBottom: `1px solid ${t.border}`,
              background: t.isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
              flexShrink: 0,
            }}>
              <span style={{
                flex: 1, minWidth: 0,
                color: t.label3, fontSize: 10, fontFamily: "monospace",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {fileView.repo !== repoName ? `${fileView.repo}/${shortenPath(fileView.path)}` : shortenPath(fileView.path)}
              </span>

              {/* Search (find in file) */}
              <button
                onMouseEnter={() => setHoveredBtn("search")}
                onMouseLeave={() => setHoveredBtn(null)}
                onClick={openFind}
                style={btnStyle("search", showFind)}
                data-tooltip="Find in file (⌘F)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </button>

              {/* Open-in dropdown */}
              <div style={{ position: "relative" }}>
                <button
                  onMouseEnter={() => setHoveredBtn("open")}
                  onMouseLeave={() => setHoveredBtn(null)}
                  onClick={(e) => { e.stopPropagation(); setShowOpenMenu((v) => !v); }}
                  style={btnStyle("open")}
                  data-tooltip="Open in…"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5"/><line x1="10" y1="14" x2="20" y2="4"/><polyline points="15 4 20 4 20 9"/>
                  </svg>
                </button>
                {showOpenMenu && (
                  <div
                    ref={openMenuRef}
                    style={{
                      position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 100,
                      background: t.surface2, border: `1px solid ${t.border}`,
                      borderRadius: 8, overflow: "hidden", minWidth: 160,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    }}
                  >
                    <div style={{ padding: "8px 12px 4px", color: t.label4, fontSize: 10, fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" }}>Open in</div>
                    {(["cursor", "vscode"] as const).map((editor) => (
                      <button
                        key={editor}
                        onClick={() => { window.terminal.openInEditor(fileView.repo, fileView.path, editor); setShowOpenMenu(false); }}
                        style={{
                          display: "block", width: "100%", textAlign: "left" as const,
                          padding: "7px 12px", background: "none", border: "none",
                          color: t.label1, fontSize: 12, cursor: "pointer",
                          fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                      >
                        {editor === "cursor" ? "Cursor" : "VS Code"}
                      </button>
                    ))}
                    <div style={{ height: 1, background: t.border, margin: "2px 0" }} />
                    <button
                      onClick={() => { window.terminal.showInFinder(fileView.repo, fileView.path); setShowOpenMenu(false); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left" as const,
                        padding: "7px 12px", background: "none", border: "none",
                        color: t.label1, fontSize: 12, cursor: "pointer",
                        fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                    >
                      Show in Finder
                    </button>
                  </div>
                )}
              </div>

              {/* Copy path */}
              <button
                onMouseEnter={() => setHoveredBtn("copy")}
                onMouseLeave={() => setHoveredBtn(null)}
                onClick={() => {
                  navigator.clipboard.writeText(`~/Documents/GitHub/${fileView.repo}/${fileView.path}`);
                  setCopiedPath(true);
                  setTimeout(() => setCopiedPath(false), 1400);
                }}
                style={{ ...btnStyle("copy"), color: copiedPath ? t.green : (hoveredBtn === "copy" ? t.label1 : t.label4) }}
                data-tooltip="Copy path"
              >
                {copiedPath
                  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
                }
              </button>
            </div>

            {/* Find bar */}
            {showFind && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
                borderBottom: `1px solid ${t.border}`, flexShrink: 0,
                background: t.isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
              }}>
                <input
                  ref={findInputRef}
                  value={findQuery}
                  onChange={(e) => { setFindQuery(e.target.value); setFindIdx(0); }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setShowFind(false); setFindQuery(""); return; }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (findTotal === 0) return;
                      setFindIdx((i) => e.shiftKey ? (i - 1 + findTotal) % findTotal : (i + 1) % findTotal);
                    }
                  }}
                  placeholder="Find in file…"
                  style={{
                    flex: 1, background: "none", border: "none", outline: "none",
                    color: t.label1, fontSize: 11,
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
                  }}
                />
                {findQuery && (
                  <span style={{ color: findTotal === 0 ? t.red : t.label4, fontSize: 10, flexShrink: 0, fontFamily: "monospace" }}>
                    {findTotal === 0 ? "No results" : `${findCurrent + 1} / ${findTotal}`}
                  </span>
                )}
                <button onClick={() => setFindIdx((i) => (i - 1 + Math.max(findTotal, 1)) % Math.max(findTotal, 1))}
                  disabled={findTotal === 0}
                  style={{ background: "none", border: "none", cursor: findTotal > 0 ? "pointer" : "default", color: t.label4, fontSize: 11, padding: "0 2px" }}>↑</button>
                <button onClick={() => setFindIdx((i) => (i + 1) % Math.max(findTotal, 1))}
                  disabled={findTotal === 0}
                  style={{ background: "none", border: "none", cursor: findTotal > 0 ? "pointer" : "default", color: t.label4, fontSize: 11, padding: "0 2px" }}>↓</button>
                <button onClick={() => { setShowFind(false); setFindQuery(""); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 13, lineHeight: 1, padding: "0 2px" }}>×</button>
              </div>
            )}

            {/* Code with line numbers */}
            <div ref={codeViewRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" }}>
              <div style={{ minWidth: "max-content" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: "monospace", fontSize: 12 }}>
                <tbody>
                  {lines.map((_, i) => {
                    const isMatch = !!(findQ && lines[i].toLowerCase().includes(findQ));
                    const isCurrent = isMatch && matchingLines[findCurrent] === i;
                    const lineHtml = isMatch ? injectMark(htmlLines[i] ?? "", findQ) : (htmlLines[i] ?? "");
                    return (
                      <tr key={i} style={{
                        background: isCurrent ? `${t.orange}30` : isMatch ? `${t.orange}14` : "transparent",
                      }}>
                        <td style={{
                          textAlign: "right" as const, paddingRight: 10, paddingLeft: 8,
                          color: t.label4, userSelect: "none",
                          borderRight: `1px solid ${t.borderSubtle}`,
                          fontSize: 11, lineHeight: "19px",
                          minWidth: 36, verticalAlign: "top",
                          position: "sticky" as const, left: 0,
                          background: isCurrent ? `${t.orange}30` : isMatch ? `${t.orange}14` : t.surface1,
                        }}>{i + 1}</td>
                        <td style={{ paddingLeft: 10, paddingRight: 16, lineHeight: "19px", whiteSpace: "pre", verticalAlign: "top" }}>
                          <span dangerouslySetInnerHTML={{ __html: lineHtml }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
