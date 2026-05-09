import { useState, useEffect } from "react";
import { useTheme } from "../ThemeContext";
import { SYS_FONT } from "../theme";

interface DiffLine {
  type: "add" | "del" | "ctx";
  content: string;
}

interface DiffChunk {
  header: string;
  lines: DiffLine[];
}

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  chunks: DiffChunk[];
}

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
    let additions = 0;
    let deletions = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("@@")) {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = { header: line, lines: [] };
      } else if (currentChunk) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          currentChunk.lines.push({ type: "add", content: line.slice(1) });
          additions++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          currentChunk.lines.push({ type: "del", content: line.slice(1) });
          deletions++;
        } else if (line.startsWith(" ")) {
          currentChunk.lines.push({ type: "ctx", content: line.slice(1) });
        }
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    if (chunks.length > 0) files.push({ path, additions, deletions, chunks });
  }

  return files;
}

interface Props {
  prNumber: number;
  repoName: string;
  prTitle: string;
  prUrl: string;
  onClose: () => void;
}

export function DiffDrawer({ prNumber, repoName, prTitle, prUrl, onClose }: Props) {
  const { theme: t } = useTheme();
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFiles, setExpandedFiles] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setLoading(true);
    setFiles([]);
    setExpandedFiles({});
    window.terminal.getPRDiff(repoName, prNumber).then((raw) => {
      const parsed = parseDiff(raw);
      setFiles(parsed);
      // expand all files by default
      const expanded: Record<number, boolean> = {};
      parsed.forEach((_, i) => (expanded[i] = true));
      setExpandedFiles(expanded);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [prNumber, repoName]);

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div style={{
      width: 320, minWidth: 280, flexShrink: 0,
      background: t.surface1,
      borderLeft: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px 7px", borderBottom: `1px solid ${t.border}`,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{
            color: t.label3, fontSize: 10, letterSpacing: "0.1em",
            textTransform: "uppercase", fontWeight: 600, flex: 1,
          }}>Branch Diff</span>
          {!loading && files.length > 0 && (
            <span style={{ color: t.label4, fontSize: 10, fontFamily: "monospace" }}>{files.length} files</span>
          )}
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: t.label4, fontSize: 14, padding: "0 2px", lineHeight: 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
          >×</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: t.blue, fontSize: 10, fontFamily: "monospace", flexShrink: 0 }}>#{prNumber}</span>
          <span style={{
            color: t.label2, fontSize: 11, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
            ...SYS_FONT,
          }}>{prTitle}</span>
        </div>
        {!loading && files.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <span style={{ color: t.green, fontSize: 10, fontFamily: "monospace" }}>+{totalAdditions}</span>
            <span style={{ color: t.red, fontSize: 10, fontFamily: "monospace" }}>−{totalDeletions}</span>
          </div>
        )}
        <button
          onClick={() => window.terminal.openExternal(prUrl)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            marginTop: 8, width: "100%",
            background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
            border: `1px solid ${t.border}`,
            borderRadius: 6, color: t.label2,
            cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "6px 0",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.09)"; e.currentTarget.style.color = t.label1; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"; e.currentTarget.style.color = t.label2; }}
        >
          <span style={{ fontSize: 12 }}>↗</span> Open in GitHub
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && (
          <div style={{ padding: "20px 14px", color: t.label4, fontSize: 11, fontFamily: "monospace" }}>
            Fetching diff…
          </div>
        )}

        {!loading && files.length === 0 && (
          <div style={{ padding: "20px 14px", color: t.label4, fontSize: 11 }}>
            No diff available.
            <div style={{ marginTop: 6, fontSize: 10, fontFamily: "monospace" }}>
              Make sure <code style={{ color: t.teal }}>gh</code> is authenticated.
            </div>
          </div>
        )}

        {/* File accordion */}
        {files.map((file, fi) => {
          const isExpanded = expandedFiles[fi] !== false;
          const fileName = file.path.split("/").pop() ?? file.path;
          return (
            <div key={fi} style={{ borderBottom: `1px solid ${t.border}` }}>
              {/* File header row */}
              <div
                onClick={() => setExpandedFiles((p) => ({ ...p, [fi]: !p[fi] }))}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 12px", cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ color: t.label4, fontSize: 9, width: 8, flexShrink: 0 }}>{isExpanded ? "▼" : "▶"}</span>
                <span style={{
                  flex: 1, color: t.label2, fontSize: 11, fontFamily: "monospace",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }} title={file.path}>{fileName}</span>
                <span style={{ color: t.green, fontSize: 10, fontFamily: "monospace", flexShrink: 0 }}>+{file.additions}</span>
                <span style={{ color: t.red, fontSize: 10, fontFamily: "monospace", flexShrink: 0 }}>−{file.deletions}</span>
              </div>

              {/* Full path (collapsed) */}
              {isExpanded && file.path !== fileName && (
                <div style={{
                  padding: "3px 12px 3px 26px", color: t.label4, fontSize: 10,
                  fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  background: t.isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                }}>{file.path}</div>
              )}

              {/* Diff chunks */}
              {isExpanded && file.chunks.map((chunk, ci) => (
                <div key={ci}>
                  {/* Chunk header */}
                  <div style={{
                    padding: "2px 12px", background: t.isDark ? "rgba(56,139,253,0.08)" : "rgba(0,100,200,0.06)",
                    color: t.blue, fontSize: 10, fontFamily: "monospace",
                    borderTop: `1px solid ${t.border}`,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{chunk.header}</div>

                  {/* Diff lines */}
                  {chunk.lines.map((line, li) => (
                    <div key={li} style={{
                      display: "flex",
                      background:
                        line.type === "add" ? (t.isDark ? "#0d2818" : "#eaffee") :
                        line.type === "del" ? (t.isDark ? "#2d1117" : "#fff0f0") :
                        "transparent",
                      borderLeft: `2px solid ${
                        line.type === "add" ? t.green :
                        line.type === "del" ? t.red :
                        "transparent"
                      }`,
                    }}>
                      <span style={{
                        color: line.type === "add" ? t.green : line.type === "del" ? t.red : t.label4,
                        fontSize: 11, fontFamily: "monospace",
                        padding: "0 4px", flexShrink: 0, userSelect: "none",
                      }}>
                        {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                      </span>
                      <span style={{
                        color:
                          line.type === "add" ? (t.isDark ? "#aff3c8" : "#24692e") :
                          line.type === "del" ? (t.isDark ? "#ffa198" : "#82071e") :
                          t.label3,
                        fontSize: 11, fontFamily: "monospace",
                        whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis",
                        paddingRight: 8,
                      }}>{line.content || " "}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
