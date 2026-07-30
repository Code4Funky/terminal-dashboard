import { useEffect, useRef, useState } from "react";
import type { Theme } from "../theme";
import { MONO_FONT, SYS_FONT, TABULAR } from "../theme";
import { CLIP, RADIUS_SM, rowState } from "../chrome";
import { useTerminal } from "../hooks/useTerminal";

/** Shared diff primitives — parsing, rendering and glyphs used by both the permanent
 *  centre pane (working tree) and the PR DiffDrawer. */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DiffLine { type: "add" | "del" | "ctx"; content: string; }
export interface DiffChunk { header: string; lines: DiffLine[]; }
export interface DiffFile { path: string; additions: number; deletions: number; chunks: DiffChunk[]; status: "A" | "D" | "M"; }

export interface WTFile {
  path: string; filename: string; dir: string;
  status: string; additions: number; deletions: number;
}

export interface CommitEntry { hash: string; subject: string; author: string; date: string; isMerge: boolean; additions: number; deletions: number; isLocal: boolean; }

// ── ANSI escape code stripper ─────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
export const stripAnsi = (s: string) => s.replace(ANSI_RE, "");

// ── Hunk header parser ────────────────────────────────────────────────────────

export function parseHunkHeader(header: string): { oldStart: number; newStart: number } {
  const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return m ? { oldStart: parseInt(m[1]), newStart: parseInt(m[2]) } : { oldStart: 1, newStart: 1 };
}

// ── Diff parser ───────────────────────────────────────────────────────────────

export function parseDiff(raw: string): DiffFile[] {
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

export function DiffChunks({ files, t }: { files: DiffFile[]; t: Theme }) {
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
                  color: t.blue, fontSize: 12, ...MONO_FONT,
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
                      background: line.type === "add" ? t.diffAddBg : line.type === "del" ? t.diffDelBg : "transparent",
                      borderLeft: `2px solid ${line.type === "add" ? t.diffAddBar : line.type === "del" ? t.diffDelBar : "transparent"}`,
                    }}>
                      {/* Old line number */}
                      <span style={{
                        width: 38, flexShrink: 0, textAlign: "right" as const,
                        color: t.label4, fontSize: 12, ...MONO_FONT,
                        padding: "0 4px 0 0", userSelect: "none",
                        borderRight: `1px solid ${t.borderSubtle}`,
                      }}>{oln ?? ""}</span>
                      {/* New line number */}
                      <span style={{
                        width: 38, flexShrink: 0, textAlign: "right" as const,
                        color: t.label4, fontSize: 12, ...MONO_FONT,
                        padding: "0 6px 0 0", userSelect: "none",
                        borderRight: `1px solid ${t.borderSubtle}`, marginRight: 4,
                      }}>{nln ?? ""}</span>
                      {/* +/- gutter */}
                      <span style={{ color: line.type === "add" ? t.diffAddFg : line.type === "del" ? t.diffDelFg : t.label4, fontSize: 13, ...MONO_FONT, padding: "0 4px", flexShrink: 0, userSelect: "none" }}>
                        {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                      </span>
                      {/* Changed lines read as code: neutral text, one step up from context so they still lead */}
                      <span style={{
                        color: line.type === "ctx" ? t.label3 : t.label1,
                        fontSize: 13, ...MONO_FONT,
                        whiteSpace: "pre", paddingRight: 16, flexShrink: 0,
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

export function ChangeBar({ additions, deletions, t }: { additions: number; deletions: number; t: Theme }) {
  const total = additions + deletions;
  if (total === 0) return <div style={{ width: 52, flexShrink: 0 }} />;
  return (
    <div style={{
      display: "flex", width: 52, height: 5, borderRadius: 3,
      overflow: "hidden", flexShrink: 0, gap: 1,
      background: t.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    }}>
      {additions > 0 && <div style={{ flex: additions, background: t.diffAddBar, borderRadius: "3px 0 0 3px" }} />}
      {deletions > 0 && <div style={{ flex: deletions, background: t.diffDelBar, borderRadius: additions > 0 ? "0 3px 3px 0" : "3px" }} />}
    </div>
  );
}

// ── Diffstat blocks ───────────────────────────────────────────────────────────

/** GitHub-style five-box diffstat. Any non-zero side always claims at least one box. */
export function StatBlocks({ additions, deletions, t }: { additions: number; deletions: number; t: Theme }) {
  const total = additions + deletions;
  if (total === 0) return null;
  let greens = additions === 0 ? 0 : Math.min(5, Math.max(1, Math.round((additions / total) * 5)));
  if (deletions > 0 && greens === 5) greens = 4;
  const reds = deletions === 0 ? 0 : 5 - greens;
  return (
    <div style={{ display: "flex", gap: 1.5, flexShrink: 0 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: 1,
          background: i < greens ? t.diffAddBar : i < greens + reds ? t.diffDelBar : t.surface3,
        }} />
      ))}
    </div>
  );
}

// ── Diff file row ─────────────────────────────────────────────────────────────

/** One `DiffFile` in a files rail. Owns its own hover so hosts don't each track a hovered key.
 *  `DiffFile` carries only a full path, so name and dir are derived here. */
export function DiffFileRow({ file, selected, onSelect, t }: {
  file: DiffFile; selected: boolean; onSelect: () => void; t: Theme;
}) {
  const [hovered, setHovered] = useState(false);
  const col = file.status === "M" ? t.blue : file.status === "A" ? t.teal : file.status === "D" ? t.diffDelFg : t.label3;
  const filename = file.path.split("/").pop() ?? file.path;
  const parts = file.path.split("/").slice(0, -1).filter(Boolean);
  const shortDir = parts.length === 0 ? "" : parts.length <= 2 ? `/${parts.join("/")}/` : `/${parts.slice(-2).join("/")}/…`;
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        padding: "6px 10px 7px 12px", cursor: "pointer",
        ...rowState(t, selected, hovered),
      }}
    >
      <span style={{
        width: 15, height: 15, flexShrink: 0, marginTop: 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 9, fontWeight: 600, color: col, background: `${col}22`,
        borderRadius: RADIUS_SM, lineHeight: 1, ...SYS_FONT,
      }}>{file.status}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          ...CLIP,
          color: file.status === "D" ? t.diffDelFg : t.label1,
          fontSize: 12, fontWeight: selected ? 600 : 400,
          textDecoration: file.status === "D" ? "line-through" : "none",
          ...SYS_FONT,
        }}>{filename}</div>

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
}

// ── Icons ─────────────────────────────────────────────────────────────────────

export const RepoGlyph = ({ color }: { color: string }) => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill={color} style={{ flexShrink: 0 }}>
    <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z" />
  </svg>
);

export const CopyGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const CheckGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const OpenGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

export const RefreshGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

// ── Pane tab ──────────────────────────────────────────────────────────────────

/** Diff-pane tab. Active state is a 2px bottom accent — the one exception to `rowState`, since a tab
 *  strip has no row to fill. */
export const paneTabStyle = (t: Theme, active: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 7, height: "100%", minWidth: 0,
  padding: "0 14px", background: "none", border: "none", cursor: "pointer",
  borderBottom: `2px solid ${active ? t.blue : "transparent"}`,
  color: active ? t.label1 : t.label3,
  fontSize: 13, fontWeight: active ? 600 : 400,
  borderRight: `1px solid ${t.borderSubtle}`,
});

// ── Session mirror ────────────────────────────────────────────────────────────

/** One mirrored pane of the session tab. Its own component because `useTerminal` is a hook and a
 *  split group has N panes. */
export function SessionMirror({ sessionId, panelNumber, visible, owns, layoutKey }: {
  sessionId: string;
  panelNumber: number;
  visible: boolean;
  /** Size ownership follows visibility: filling the dock makes this the only view of the PTY, so it
   *  drives cols/rows; side by side with the dock panel it must not, or the two fight. */
  owns: boolean;
  /** Any geometry change — pane count, axis, drawer width. */
  layoutKey: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // DOM renderer: WebGL paints this pane ~29 rows low (measured).
  const term = useTerminal(hostRef, sessionId, panelNumber, undefined, undefined, undefined,
    { rendererType: "dom", ownsPtySize: owns });

  // A hidden host measures 0×0, so xterm needs a nudge once the pane is shown or the layout moves
  useEffect(() => {
    if (visible) term.refit();
  }, [visible, layoutKey]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}
