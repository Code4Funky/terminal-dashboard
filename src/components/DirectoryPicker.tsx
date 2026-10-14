import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "../ThemeContext";
import { MONO_FONT, SYS_FONT } from "../theme";
import { RADIUS } from "../chrome";

interface Props {
  onClose: () => void;
  // label is "" when opening at $HOME, so the caller falls back to the default name.
  onOpenDir: (absPath: string, label: string) => void;
  repos: { name: string }[];
  initialPath?: string; // directory to start browsing from (default: $HOME)
  openLabel?: string; // footer CTA text (default: "Open here")
  openHint?: string; // hint-bar verb for ⌘↵ (default: "open terminal")
  title?: string; // header text (default: "New Terminal")
}

type Row =
  | { kind: "parent"; name: string; path: string }
  | { kind: "recent"; name: string; path: string | undefined } // undefined → $HOME
  | { kind: "dir"; name: string; path: string; count: number | null };

function FolderIcon({ color, size = 15 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

export function DirectoryPicker({ onClose, onOpenDir, repos, initialPath, openLabel = "Open here", openHint = "open terminal", title = "New Terminal" }: Props) {
  const { theme: t } = useTheme();

  const [nav, setNav] = useState<string | undefined>(initialPath); // undefined → $HOME
  const [path, setPath] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [home, setHome] = useState("");
  const [entries, setEntries] = useState<{ name: string; path: string; count: number | null }[]>([]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [frequent, setFrequent] = useState<{ name: string }[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { window.terminal.getFrequentDirs().then(setFrequent).catch(() => {}); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.terminal.listDirs(nav, showHidden).then((res) => {
      if (cancelled) return;
      setPath(res.path); setParent(res.parent); setHome(res.home); setEntries(res.entries);
      setQuery(""); setCursor(0); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [nav, showHidden]);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => { selectedRef.current?.scrollIntoView({ block: "nearest" }); }, [cursor]);

  const pretty = (p: string) => (home && p.startsWith(home) ? "~" + p.slice(home.length) : p);
  // Elide from the left so the current folder (tail) stays visible.
  const elide = (p: string, max = 52) => (p.length <= max ? p : "…" + p.slice(p.length - (max - 1)));
  const expand = (p: string) => (home && p.startsWith("~") ? home + p.slice(1) : p);

  const filtered = useMemo(
    () => (query ? entries.filter((e) => e.name.toLowerCase().includes(query.toLowerCase())) : entries),
    [entries, query]
  );

  // ~ + most-visited dirs first, then any caller-supplied repos; dedup by name.
  const shortcuts = useMemo(() => {
    const seen = new Set<string>();
    const chips: { label: string; path: string | undefined }[] = [{ label: "~", path: undefined }];
    for (const r of [...frequent, ...repos]) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      chips.push({ label: r.name, path: `~/Documents/GitHub/${r.name}` });
    }
    return chips;
  }, [frequent, repos]);

  // A query searches the Recent chips too, not just the current dir — prefix matches rank first.
  const matchedRecents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const inView = new Set(filtered.map((e) => e.path));
    return shortcuts
      .filter((s) => s.label.toLowerCase().includes(q) && (!s.path || !inView.has(expand(s.path))))
      .sort((a, b) => Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)))
      .slice(0, 8);
  }, [query, shortcuts, filtered, home]);

  const rows = useMemo<Row[]>(() => [
    ...matchedRecents.map((s) => ({ kind: "recent" as const, name: s.label, path: s.path })),
    // Hide the parent row while filtering — it never matches the query.
    ...(parent && !query ? [{ kind: "parent" as const, name: ".. (parent directory)", path: parent }] : []),
    ...filtered.map((e) => ({ kind: "dir" as const, name: e.name, path: e.path, count: e.count })),
  ], [parent, filtered, matchedRecents, query]);

  const openHere = () => {
    if (!path) return;
    const label = path === home ? "" : (path.split("/").filter(Boolean).pop() ?? "");
    onOpenDir(path, label);
    onClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); openHere(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === ".") { e.preventDefault(); setShowHidden((v) => !v); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
      // Backspace on an empty query walks up a level (Warp behaviour).
      if (e.key === "Backspace" && !query && parent) { e.preventDefault(); setNav(parent); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[Math.min(cursor, rows.length - 1)];
        if (row) setNav(row.path);
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [rows, cursor, path, parent, query, home]);

  // Deterministic decorative colour per name — folder icons.
  const PALETTE = [t.blue, t.green, t.purple, t.orange, t.red, t.teal];
  const colorFor = (name: string) => {
    if (name === "~") return t.green;
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  };

  const kbdStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    minWidth: 18, height: 18, padding: "0 5px", borderRadius: RADIUS,
    border: `1px solid ${t.borderMid}`, background: t.surface2, color: t.label2,
    fontSize: 10.5, ...MONO_FONT,
  };
  const hintItem: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6 };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: t.surface1, border: `1px solid ${t.border}`,
          borderRadius: RADIUS, width: 560, overflow: "hidden",
          boxShadow: t.isDark ? "0 32px 80px rgba(0,0,0,0.7)" : "0 16px 48px rgba(0,0,0,0.18)",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 16px", borderBottom: `1px solid ${t.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <span style={{ color: t.label1, fontSize: 15, fontWeight: 600, flexShrink: 0, ...SYS_FONT }}>{title}</span>
            <span style={{
              color: t.label3, fontSize: 11.5, ...MONO_FONT,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{path ? pretty(path) : ""}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setNav(undefined)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: t.surface2, border: `1px solid ${t.borderMid}`, borderRadius: RADIUS,
                padding: "5px 11px", cursor: "pointer", ...SYS_FONT,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.surface3; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = t.surface2; }}
            >
              <span style={{ ...MONO_FONT, fontSize: 12, color: t.label3 }}>~</span>
              <span style={{ fontSize: 11.5, color: t.label2 }}>home</span>
            </button>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", cursor: "pointer", color: t.label3, fontSize: 20, lineHeight: 1, padding: "0 2px" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
              onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
            >×</button>
          </div>
        </div>

        {/* Search — recents are reachable by typing, so no pinned-chip row */}
        <div style={{ padding: "12px 14px" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: t.surface2, border: `1px solid ${t.borderMid}`, borderRadius: RADIUS, padding: "10px 12px",
          }}>
            <span style={{ display: "flex", color: t.label3, flexShrink: 0 }}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search directories or recent repos…"
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: t.label1, fontSize: 13.5, ...SYS_FONT }}
            />
            <span style={{ fontSize: 11, color: t.label4, flexShrink: 0, ...SYS_FONT }}>{matchedRecents.length + filtered.length} dirs</span>
          </div>
        </div>

        {/* Directory list */}
        <div style={{ maxHeight: 340, overflowY: "auto", padding: "0 14px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
          {loading ? (
            <div style={{ padding: "14px 6px", color: t.label4, fontSize: 12.5, ...SYS_FONT }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: "14px 6px", color: t.label4, fontSize: 12.5, ...SYS_FONT }}>
              {query ? `No directories match "${query}"` : "No subdirectories"}
            </div>
          ) : (
            rows.map((row, i) => {
              const isSel = i === Math.min(cursor, rows.length - 1);
              const isParent = row.kind === "parent";
              const isRecent = row.kind === "recent";
              const count = row.kind === "dir" ? row.count : null;
              return (
                <button
                  key={row.path + i}
                  ref={isSel ? selectedRef : undefined}
                  onClick={() => setNav(row.path)}
                  onMouseEnter={() => setCursor(i)}
                  style={{
                    display: "flex", alignItems: "center", gap: 13, width: "100%", textAlign: "left",
                    background: isSel ? `${t.blue}1f` : "transparent",
                    border: `1px solid ${isSel ? `${t.blue}55` : (isParent ? t.borderSubtle : "transparent")}`,
                    borderRadius: RADIUS, padding: "12px 14px",
                    cursor: "pointer", transition: "background 0.1s, border-color 0.1s",
                  }}
                >
                  <span style={{ flexShrink: 0, display: "flex", width: 18, justifyContent: "center", color: isParent ? t.blue : colorFor(row.name), fontSize: 16 }}>
                    {isParent ? "↑" : <FolderIcon color={colorFor(row.name)} size={18} />}
                  </span>
                  <span style={{
                    flex: 1, fontSize: 14,
                    color: isParent ? t.label3 : t.label1,
                    fontStyle: isParent ? "italic" : "normal",
                    ...SYS_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{row.name}</span>
                  {isRecent && (
                    <>
                      <span style={{ fontSize: 11, color: t.label4, flexShrink: 0, ...MONO_FONT }}>{elide(row.path ?? "~", 26)}</span>
                      <span style={{
                        fontSize: 9.5, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase",
                        color: t.label3, background: t.surface2, border: `1px solid ${t.borderMid}`,
                        borderRadius: RADIUS, padding: "2px 6px", flexShrink: 0, ...SYS_FONT,
                      }}>recent</span>
                    </>
                  )}
                  {count != null && (
                    <span style={{ fontSize: 12, color: isSel ? t.label3 : t.label4, flexShrink: 0, ...SYS_FONT }}>{count} item{count === 1 ? "" : "s"}</span>
                  )}
                  {isSel && !isParent && (
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={t.blue} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M9 6l6 6-6 6" /></svg>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer: open at the directory currently being browsed */}
        <div style={{ borderTop: `1px solid ${t.border}`, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={openHere}
            disabled={!path}
            style={{
              display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, textAlign: "left",
              background: `${t.blue}14`, border: `1px solid ${t.blue}44`, borderRadius: RADIUS,
              padding: "11px 14px", cursor: path ? "pointer" : "default", transition: "all 0.13s",
            }}
            onMouseEnter={(e) => { if (path) e.currentTarget.style.background = `${t.blue}22`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `${t.blue}14`; }}
          >
            <span style={{ flexShrink: 0, display: "flex" }}><FolderIcon color={t.blue} size={17} /></span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: t.label1, ...MONO_FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
              {path ? elide(pretty(path), 46) : "…"}
            </span>
            <span style={{ ...kbdStyle, padding: "0 7px", color: t.blue, borderColor: `${t.blue}55`, background: `${t.blue}12` }}>⌘ ↵</span>
            <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, color: t.blue, ...SYS_FONT }}>{openLabel}</span>
          </button>
        </div>

        {/* Hint bar */}
        <div style={{
          borderTop: `1px solid ${t.border}`, padding: "8px 14px",
          display: "flex", gap: 16, color: t.label4, fontSize: 11, alignItems: "center", ...SYS_FONT,
        }}>
          <span style={hintItem}><kbd style={kbdStyle}>↑↓</kbd> navigate</span>
          <span style={hintItem}><kbd style={kbdStyle}>↵</kbd> open folder</span>
          <span style={hintItem}><kbd style={kbdStyle}>⌘.</kbd> {showHidden ? "hide" : "show"} hidden</span>
          <span style={hintItem}><kbd style={kbdStyle}>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
