import { useState, useEffect, useRef, useMemo } from "react";
import { useTheme } from "../ThemeContext";
import { SYS_FONT } from "../theme";
import type { TerminalTab } from "./RepoSidebar";

interface Props {
  tabs: TerminalTab[];
  focusedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function shortPath(cwd?: string): string {
  if (!cwd) return "";
  const home = cwd.replace(/^\/Users\/[^/]+/, "~");
  const parts = home.split("/").filter(Boolean);
  if (parts.length <= 3) return home;
  return "~/" + parts.slice(-2).join("/");
}

function repoLabel(tab: TerminalTab): string {
  if (tab.cwd) {
    const parts = tab.cwd.split("/").filter(Boolean);
    const last = parts.at(-1);
    if (last && last !== tab.title) return last;
  }
  return tab.title;
}

export function SessionSwitcher({ tabs, focusedId, onSelect, onClose }: Props) {
  const { theme: t } = useTheme();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return tabs.filter(
      (tab) =>
        !q ||
        tab.title.toLowerCase().includes(q) ||
        (tab.cwd ?? "").toLowerCase().includes(q) ||
        (tab.gitBranch ?? "").toLowerCase().includes(q)
    );
  }, [tabs, query]);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const confirm = (idx: number) => {
    const tab = filtered[idx];
    if (tab) { onSelect(tab.id); onClose(); }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      confirm(cursor);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: 80,
        background: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 440,
        background: t.isDark ? "rgba(28,28,30,0.96)" : "rgba(255,255,255,0.96)",
        border: `1px solid ${t.border}`,
        borderRadius: 14,
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        overflow: "hidden",
        backdropFilter: "blur(40px) saturate(200%)",
        WebkitBackdropFilter: "blur(40px) saturate(200%)",
      }}>
        {/* Search bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px",
          borderBottom: `1px solid ${t.borderMid}`,
        }}>
          <span style={{ fontSize: 14, color: t.label3, lineHeight: 1 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search sessions…"
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              fontSize: 13, color: t.label1, ...SYS_FONT,
            }}
          />
          <span style={{ fontSize: 10, color: t.label4, ...SYS_FONT, letterSpacing: 0.3 }}>ESC</span>
        </div>

        {/* Session list */}
        <div ref={listRef} style={{ maxHeight: 360, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "16px 14px", fontSize: 12, color: t.label4, ...SYS_FONT }}>
              No sessions match.
            </div>
          ) : (
            filtered.map((tab, i) => {
              const active = tab.id === focusedId;
              const selected = i === cursor;
              return (
                <div
                  key={tab.id}
                  onMouseEnter={() => setCursor(i)}
                  onMouseDown={() => confirm(i)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 14px",
                    cursor: "pointer",
                    background: selected
                      ? t.isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.06)"
                      : "transparent",
                    borderBottom: `1px solid ${t.borderSubtle}`,
                    transition: "background 0.08s",
                  }}
                >
                  {/* Terminal indicator dot */}
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: active ? t.green : t.label4,
                    boxShadow: active ? `0 0 6px ${t.green}80` : undefined,
                  }} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Title row */}
                    <div style={{
                      fontSize: 13, fontWeight: selected ? 600 : 400,
                      color: t.label1, ...SYS_FONT,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {repoLabel(tab)}
                    </div>

                    {/* Path + branch row */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6, marginTop: 2,
                    }}>
                      {tab.cwd && (
                        <span style={{
                          fontSize: 10, color: t.label3, fontFamily: "monospace",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          maxWidth: tab.gitBranch ? 200 : 300,
                        }}>
                          {shortPath(tab.cwd)}
                        </span>
                      )}
                      {tab.gitBranch && (
                        <span style={{
                          fontSize: 10, fontFamily: "monospace",
                          color: t.red, flexShrink: 0,
                        }}>
                          git:({tab.gitBranch})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Focused indicator */}
                  {active && (
                    <span style={{ fontSize: 9, color: t.green, ...SYS_FONT, letterSpacing: 0.3, flexShrink: 0 }}>
                      ACTIVE
                    </span>
                  )}

                  {/* Session number */}
                  <span style={{ fontSize: 10, color: t.label4, fontFamily: "monospace", flexShrink: 0 }}>
                    #{tab.id.slice(-4)}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12,
          padding: "6px 14px",
          borderTop: `1px solid ${t.borderSubtle}`,
          background: t.isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.03)",
        }}>
          {[["↑↓", "navigate"], ["↵", "open"], ["esc", "close"]].map(([key, label]) => (
            <span key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: t.label4, ...SYS_FONT }}>
              <kbd style={{
                background: t.surface2, border: `1px solid ${t.borderMid}`,
                borderRadius: 4, padding: "1px 5px", fontSize: 10, fontFamily: "monospace",
                color: t.label3,
              }}>{key}</kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
