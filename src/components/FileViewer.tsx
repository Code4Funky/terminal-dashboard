import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTheme } from "../ThemeContext";
import { EditorView, keymap, Decoration, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { EditorState, Compartment, Prec, Annotation } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { xml } from "@codemirror/lang-xml";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sql } from "@codemirror/lang-sql";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { kotlin, scala, java, c, cpp, csharp, objectiveC } from "@codemirror/legacy-modes/mode/clike";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { RADIUS, RADIUS_SM } from "../chrome";
import { MONO_FONT, SYS_FONT } from "../theme";
import type { Theme } from "../theme";

/** Idle time before an edit is written. Long enough to coalesce a burst of typing. */
const AUTOSAVE_MS = 600;
/** Marks a doc swap that came from disk, so it can't re-trigger a save of what we just read. */
const Reload = Annotation.define<boolean>();

interface Props {
  repo: string;
  path: string;
  treeRepo?: string | null;
  onClose: () => void;
  width?: number;
  onWidthChange?: (w: number) => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  /** Take the whole dock — set when the terminal is hidden, so width/resize no longer apply. */
  fill?: boolean;
  /** Terminal is docked below this viewer rather than beside it. */
  stacked?: boolean;
  onToggleStacked?: () => void;
  /** 1-based line of the search hit that opened this file — scrolled to and marked current. */
  line?: number;
  /** The search query behind that hit, so every occurrence is marked. */
  match?: string;
}

/** Language for a path: Lezer grammars where they exist, legacy stream modes otherwise. */
function cmLanguage(filePath: string): Extension {
  const name = filePath.split("/").pop()?.toLowerCase() ?? "";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  if (name === "dockerfile") return StreamLanguage.define(dockerFile);
  if (name === "jenkinsfile") return StreamLanguage.define(groovy);
  switch (ext) {
    case "kt": case "kts": return StreamLanguage.define(kotlin);
    case "scala": case "sbt": return StreamLanguage.define(scala);
    case "java": return StreamLanguage.define(java);
    case "c": case "h": return StreamLanguage.define(c);
    case "cpp": case "cc": case "hpp": return StreamLanguage.define(cpp);
    case "cs": return StreamLanguage.define(csharp);
    case "m": return StreamLanguage.define(objectiveC);
    case "sh": case "bash": case "zsh": return StreamLanguage.define(shell);
    case "gradle": case "groovy": return StreamLanguage.define(groovy);
    case "properties": case "ini": return StreamLanguage.define(properties);
    case "toml": return StreamLanguage.define(toml);
    case "rb": return StreamLanguage.define(ruby);
    case "swift": return StreamLanguage.define(swift);
    case "ts": return javascript({ typescript: true });
    case "tsx": return javascript({ typescript: true, jsx: true });
    case "jsx": return javascript({ jsx: true });
    case "js": case "mjs": case "cjs": return javascript();
    case "py": return python();
    case "json": case "jsonc": return json();
    case "md": case "markdown": return markdown();
    case "yml": case "yaml": return yaml();
    case "xml": return xml();
    case "html": case "htm": return html();
    case "css": case "scss": return css();
    case "sql": return sql();
    case "rs": return rust();
    case "go": return go();
    default: return [];
  }
}

function editorTheme(t: Theme): Extension {
  return EditorView.theme({
    "&": { background: "transparent", color: t.label1, height: "100%", fontSize: "12px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: MONO_FONT.fontFamily, lineHeight: "19px" },
    ".cm-content": { caretColor: t.blue, padding: "2px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: t.blue },
    ".cm-gutters": {
      background: t.surface1, color: t.label4, border: "none",
      borderRight: `1px solid ${t.borderSubtle}`, fontSize: "11px",
    },
    ".cm-activeLineGutter": { background: "transparent", color: t.label2 },
    ".cm-activeLine": { background: t.isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: `${t.blue}33` },
    ".cm-tdMatch": { background: t.matchBg, color: t.label1, borderRadius: `${RADIUS_SM}px` },
    ".cm-tdMatchCurrent": {
      background: t.matchBg, color: t.label1,
      borderRadius: `${RADIUS_SM}px`, boxShadow: `inset 0 0 0 1px ${t.blue}`,
    },
    // The find bar is ours; CodeMirror's own panels would duplicate it
    ".cm-panels": { display: "none" },
  }, { dark: t.isDark });
}

/** Marks every occurrence of the query, outlining the one the find bar is on. */
function matchHighlighter(query: string, currentAt: number): Extension {
  const mark = Decoration.mark({ class: "cm-tdMatch" });
  const current = Decoration.mark({ class: "cm-tdMatchCurrent" });
  const needle = query.toLowerCase();
  const build = (view: EditorView): DecorationSet => {
    const hay = view.state.doc.toString().toLowerCase();
    const out: Range<Decoration>[] = [];
    let at = hay.indexOf(needle);
    let n = 0;
    while (at !== -1) {
      out.push((n === currentAt ? current : mark).range(at, at + needle.length));
      n++;
      at = hay.indexOf(needle, at + needle.length);
    }
    return Decoration.set(out);
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = build(view); }
      update(u: ViewUpdate) { if (u.docChanged) this.decorations = build(u.view); }
    },
    { decorations: (v) => v.decorations }
  );
}

export function FileViewer({ repo, path, treeRepo, onClose, width: controlledWidth, onWidthChange, maximized = false, onToggleMaximize, fill = false, stacked = false, onToggleStacked, line, match }: Props) {
  const { theme: t } = useTheme();

  // ── Drawer resize ────────────────────────────────────────────────────────────
  const [internalWidth, setInternalWidth] = useState(controlledWidth ?? 640);
  const drawerWidth = controlledWidth ?? internalWidth;
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: drawerWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const delta = dragState.current.startX - ev.clientX;
      // Ceiling tracks the window so a maximised drawer doesn't snap narrow when dragged
      const max = Math.max(900, window.innerWidth - 360);
      const w = Math.max(320, Math.min(max, dragState.current.startWidth + delta));
      if (controlledWidth !== undefined) { onWidthChange?.(w); } else { setInternalWidth(w); }
    };
    const onUp = () => { dragState.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── File content ─────────────────────────────────────────────────────────────
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [copiedPath, setCopiedPath] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileKey = `${repo}//${path}`;
  /** Unsaved text per file, so switching away and back doesn't lose edits. */
  const buffers = useRef(new Map<string, string>());
  /**
   * Which file the editor's doc actually holds. Props change a render before the new text
   * arrives, so every read/write of the doc is gated on this, never on `path`.
   */
  const docKey = useRef("");
  const onDisk = useRef("");
  const pending = useRef<{ key: string; disk: string; text: string } | null>(null);

  // ── Find-in-file ─────────────────────────────────────────────────────────────
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIdx, setFindIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  // ── Open-in dropdown ─────────────────────────────────────────────────────────
  const [showOpenMenu, setShowOpenMenu] = useState(false);
  const openMenuRef = useRef<HTMLDivElement>(null);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setShowFind(false);
    setSaveError(null);
    window.terminal.readRepoFile(repo, path).then((c) => {
      if (stale) return;
      const key = `${repo}//${path}`;
      const disk = c ?? "";
      // A buffered edit for this file wins over disk, so a file switch can't discard it
      const text = buffers.current.get(key) ?? disk;
      pending.current = { key, disk, text };
      setContent(text);
      setDirty(text !== disk);
      setLoadFailed(c === null);
      setLoading(false);
    }).catch((e) => {
      if (stale) return;
      // Without this the viewer sticks on "loading" forever and keeps showing the previous file
      pending.current = { key: `${repo}//${path}`, disk: "", text: "" };
      setLoadFailed(true);
      setLoading(false);
    });
    return () => { stale = true; };
  }, [repo, path]);

  // Clicking a hit re-seeds the query without re-reading the file
  useEffect(() => { setFindQuery(match ?? ""); setFindIdx(0); }, [match, repo, path]);

  useEffect(() => {
    if (!showOpenMenu) return;
    const handler = (e: MouseEvent) => {
      if (openMenuRef.current?.contains(e.target as Node)) return;
      setShowOpenMenu(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [showOpenMenu]);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const findQ = findQuery.toLowerCase();
  const matchPositions = useMemo(() => {
    if (!findQ) return [];
    const hay = content.toLowerCase();
    const out: number[] = [];
    let at = hay.indexOf(findQ);
    while (at !== -1) { out.push(at); at = hay.indexOf(findQ, at + findQ.length); }
    return out;
  }, [findQ, content]);

  const findTotal = matchPositions.length;
  const findCurrent = findTotal > 0 ? ((findIdx % findTotal) + findTotal) % findTotal : 0;

  // ── Editor ───────────────────────────────────────────────────────────────────
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());
  const markComp = useRef(new Compartment());
  const roComp = useRef(new Compartment());

  const save = useCallback(async () => {
    const view = viewRef.current;
    const key = `${repo}//${path}`;
    // A failed read leaves an empty buffer — saving it would truncate the file
    if (!view || loadFailed) return;
    // Never write the doc to a path it isn't showing — that overwrites one file with another
    if (docKey.current !== key) return;
    const text = view.state.doc.toString();
    if (text === onDisk.current) return;
    setSaving(true);
    let res: { ok: boolean; error?: string };
    try {
      // A rejected invoke means a stale main process (no such channel) — surface it
      // rather than letting the save look dead.
      res = await window.terminal.writeRepoFile(repo, path, text);
    } catch (e) {
      setSaving(false);
      setSaveError((e as Error).message.includes("No handler") ? "Restart the app to enable saving" : "Save failed");
      return;
    }
    setSaving(false);
    if (!res?.ok) { setSaveError(res?.error ?? "Save failed"); return; }
    // The doc may have moved on to another file while the write was in flight
    if (docKey.current === key) onDisk.current = text;
    buffers.current.delete(key);
    // Only clean if the doc is still this file and nothing was typed while the write was in flight
    if (docKey.current === key && viewRef.current?.state.doc.toString() === text) setDirty(false);
    setSaveError(null);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1200);
  }, [repo, path, loadFailed]);

  // ── Autosave ─────────────────────────────────────────────────────────────────
  const saveTimer = useRef<number | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveRef.current();
    }, AUTOSAVE_MS);
  }, []);
  const scheduleSaveRef = useRef(scheduleSave);
  scheduleSaveRef.current = scheduleSave;

  /** Write now instead of waiting out the debounce — used before the buffer goes away. */
  const flush = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    void saveRef.current();
  }, []);

  // Cleanup closes over the outgoing file, so a switch or close commits it to the right path
  useEffect(() => flush, [flush, save]);

  // Leaving the app is the other point of no return for a pending write
  useEffect(() => {
    window.addEventListener("blur", flush);
    return () => window.removeEventListener("blur", flush);
  }, [flush]);

  // ── Reload on external change ────────────────────────────────────────────────
  useEffect(() => {
    void window.terminal.watchRepoFile(repo, path);
    return () => { void window.terminal.unwatchRepoFile(); };
  }, [repo, path]);

  useEffect(() => window.terminal.onFileChanged((r, p, c) => {
    const view = viewRef.current;
    const key = `${repo}//${path}`;
    if (r !== repo || p !== path || !view || docKey.current !== key) return;
    // Our own pending write is newer than what the watcher saw — let it land instead
    if (saveTimer.current || saving) return;
    onDisk.current = c;
    pending.current = { key, disk: c, text: c };
    buffers.current.delete(key);
    if (view.state.doc.toString() === c) { setDirty(false); return; }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: c },
      // Keep the caret where it was rather than jumping to the top
      selection: { anchor: Math.min(view.state.selection.main.head, c.length) },
      annotations: Reload.of(true),
    });
    setDirty(false);
  }), [repo, path, saving]);

  const openFind = useCallback(() => {
    setShowFind(true);
    setTimeout(() => findInputRef.current?.focus(), 50);
  }, []);

  // The editor is built once, so its keymap reaches the current handlers through refs
  const openFindRef = useRef(openFind);
  openFindRef.current = openFind;

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          langComp.current.of([]),
          themeComp.current.of([]),
          markComp.current.of([]),
          roComp.current.of([]),
          // Outranks basicSetup's search keymap, which would open CodeMirror's own panel
          Prec.highest(keymap.of([
            { key: "Mod-f", run: () => { openFindRef.current(); return true; } },
            { key: "Mod-s", run: () => { void saveRef.current(); return true; } },
          ])),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            const text = u.state.doc.toString();
            setContent(text);
            // A doc swap on load or external reload isn't an edit — attributing it to the
            // incoming file is what let one file's text get buffered under another's name
            if (u.transactions.some((tr) => tr.annotation(Reload))) return;
            const isDirty = text !== onDisk.current;
            setDirty(isDirty);
            if (isDirty) buffers.current.set(docKey.current, text);
            else buffers.current.delete(docKey.current);
            if (isDirty) scheduleSaveRef.current();
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, []);

  // Adopt the freshly loaded text, once per file. Gated on pending's own key: `loading`
  // is a render behind on a file switch, so it can't be trusted to say what's arrived.
  useEffect(() => {
    const view = viewRef.current;
    const p = pending.current;
    if (!view || !p || p.key !== fileKey || docKey.current === fileKey) return;
    docKey.current = fileKey;
    onDisk.current = p.disk;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: p.text },
      selection: { anchor: 0 },
      annotations: Reload.of(true),
    });
    setDirty(p.text !== p.disk);
    // A restored buffer is unsaved work — commit it rather than waiting for a keystroke
    if (p.text !== p.disk) scheduleSave();
  }, [loading, fileKey, scheduleSave]);

  useEffect(() => { viewRef.current?.dispatch({ effects: langComp.current.reconfigure(cmLanguage(path)) }); }, [path]);
  useEffect(() => {
    // oneDark first so our own rules win where they overlap
    viewRef.current?.dispatch({ effects: themeComp.current.reconfigure([...(t.isDark ? [oneDark] : []), editorTheme(t)]) });
  }, [t]);
  useEffect(() => { viewRef.current?.dispatch({ effects: roComp.current.reconfigure(EditorState.readOnly.of(loadFailed)) }); }, [loadFailed]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: markComp.current.reconfigure(findQ ? matchHighlighter(findQ, findCurrent) : []) });
  }, [findQ, findCurrent]);

  // Keep the current match on screen as the find bar walks them
  useEffect(() => {
    const view = viewRef.current;
    const pos = matchPositions[findCurrent];
    if (!view || pos === undefined) return;
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  }, [findCurrent, matchPositions]);

  // Land on the clicked search hit once its file is in. Keyed so typing in the find
  // bar (which rebuilds matchPositions) can't yank the view back here.
  const jumpedTo = useRef("");
  useEffect(() => {
    const key = `${repo}:${path}:${line}:${match}`;
    const view = viewRef.current;
    if (loading || !line || !view || jumpedTo.current === key) return;
    jumpedTo.current = key;
    const at = matchPositions.findIndex((p) => view.state.doc.lineAt(p).number === line);
    if (at >= 0) { setFindIdx(at); return; }
    const target = view.state.doc.line(Math.min(line, view.state.doc.lines));
    view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: "center" }) });
  }, [repo, path, line, match, loading, matchPositions]);

  const hoverBg = t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";

  const btnStyle = (key: string, active = false): React.CSSProperties => ({
    background: active ? `${t.blue}20` : "none",
    border: `1px solid ${active ? t.blue + "50" : "transparent"}`,
    borderRadius: RADIUS, cursor: "pointer",
    color: active ? t.blue : hoveredBtn === key ? t.label1 : t.label4,
    padding: 0, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 26, height: 26,
    transition: "color 0.1s, background 0.1s",
  });

  return (
    <div
      style={{
        ...(fill ? { flex: 1, minHeight: 0 } : { width: drawerWidth, flexShrink: 0 }),
        minWidth: 320,
        background: t.surface1, borderLeft: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column", position: "relative",
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "f") { e.preventDefault(); e.stopPropagation(); openFind(); }
        if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); e.stopPropagation(); void save(); }
      }}
    >
      {/* Left resize handle — nothing to drag against when filling */}
      {!fill && (
        <div
          onMouseDown={onResizeMouseDown}
          style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 10 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = `${t.blue}40`; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        />
      )}

      {/* Path bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4, padding: "5px 8px 5px 12px",
        borderBottom: `1px solid ${t.border}`,
        background: t.isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
        flexShrink: 0,
      }}>
        <span style={{
          flex: 1, minWidth: 0,
          color: t.label3, fontSize: 10, ...MONO_FONT,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" as const,
        }}>
          {repo !== treeRepo ? `${repo}/${path}` : path}
        </span>

        {(dirty || saving) && !saveError && (
          <span title="Saving" style={{ width: 5, height: 5, borderRadius: "50%", background: t.orange, flexShrink: 0 }} />
        )}
        {loadFailed && <span style={{ color: t.red, fontSize: 10, flexShrink: 0, ...SYS_FONT }}>Could not read</span>}
        {saveError && <span style={{ color: t.red, fontSize: 10, flexShrink: 0, ...SYS_FONT }}>{saveError}</span>}
        {justSaved && !dirty && <span style={{ color: t.green, fontSize: 10, flexShrink: 0, ...SYS_FONT }}>Saved</span>}

        {onToggleStacked && (
          <button
            onMouseEnter={() => setHoveredBtn("stack")}
            onMouseLeave={() => setHoveredBtn(null)}
            onClick={onToggleStacked}
            style={btnStyle("stack", stacked)}
            data-tooltip={stacked ? "Terminal beside (⌘⇧O)" : "Terminal below (⌘⇧O)"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="1"/>
              {stacked ? <path d="M12 4v16"/> : <path d="M3 15h18"/>}
            </svg>
          </button>
        )}

        {/* Maximise is a width control, so it means nothing once the viewer already fills the row */}
        {onToggleMaximize && !stacked && (
          <button
            onMouseEnter={() => setHoveredBtn("max")}
            onMouseLeave={() => setHoveredBtn(null)}
            onClick={onToggleMaximize}
            style={btnStyle("max", maximized)}
            data-tooltip={maximized ? "Restore width" : "Maximise"}
          >
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {maximized
                ? <><polyline points="4 4 10 10 4 16" /><polyline points="11 4 17 10 11 16" /></>
                : <><polyline points="16 4 10 10 16 16" /><polyline points="9 4 3 10 9 16" /></>}
            </svg>
          </button>
        )}

        {/* Find in file */}
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
                borderRadius: RADIUS, overflow: "hidden", minWidth: 160,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}
            >
              <div style={{ padding: "8px 12px 4px", color: t.label4, fontSize: 10, ...SYS_FONT }}>Open in</div>
              {(["cursor", "vscode"] as const).map((editor) => (
                <button
                  key={editor}
                  onClick={() => { window.terminal.openInEditor(repo, path, editor); setShowOpenMenu(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left" as const,
                    padding: "7px 12px", background: "none", border: "none",
                    color: t.label1, fontSize: 12, cursor: "pointer",
                    ...SYS_FONT,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                >
                  {editor === "cursor" ? "Cursor" : "VS Code"}
                </button>
              ))}
              <div style={{ height: 1, background: t.border, margin: "2px 0" }} />
              <button
                onClick={() => { window.terminal.showInFinder(repo, path); setShowOpenMenu(false); }}
                style={{
                  display: "block", width: "100%", textAlign: "left" as const,
                  padding: "7px 12px", background: "none", border: "none",
                  color: t.label1, fontSize: 12, cursor: "pointer",
                  ...SYS_FONT,
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
            navigator.clipboard.writeText(`~/Documents/GitHub/${repo}/${path}`);
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

        <button
          onClick={() => { flush(); onClose(); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 14, lineHeight: 1, padding: "0 2px" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
        >×</button>
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
              ...SYS_FONT,
            }}
          />
          {findQuery && (
            <span style={{ color: findTotal === 0 ? t.red : t.label4, fontSize: 10, flexShrink: 0, ...MONO_FONT }}>
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

      {/* Editor */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
        {loading && (
          <div style={{ position: "absolute", inset: 0, background: t.surface1, padding: 12, color: t.label4, fontSize: 11, ...MONO_FONT }}>Loading…</div>
        )}
      </div>
    </div>
  );
}
