import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "../ThemeContext";
import type { Theme } from "../theme";

// ── Types ─────────────────────────────────────────────────────────────────────
type Mode = "kb" | "code";

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  timestamp: number;
  toolActivity?: string;
}

interface ChatSession {
  id: string;
  title: string;
  mode: Mode;
  messages: ChatMessage[];
  claudeSessionId: string | null;
  tokenUsage: TokenUsage;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_WIKI_DIR = "~/Documents/GitHub/knowledge-base/wiki";

interface ChatSettings { model: string; wikiDir: string; }

const MODELS: { id: string; label: string; desc: string }[] = [
  { id: "claude-sonnet-4-6",        label: "Sonnet 4.6",  desc: "Balanced — fast & capable" },
  { id: "claude-opus-4-6",          label: "Opus 4.6",    desc: "Most capable, higher cost" },
  { id: "claude-haiku-4-5-20251001",label: "Haiku 4.5",   desc: "Fast & lightweight" },
];

interface Props { onClose: () => void; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const STOP_WORDS = new Set(["a","an","the","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","shall","can","of","in","on","at","to","for","with","by","from","as","into","through","during","before","after","above","below","up","down","out","off","over","under","again","further","then","once","i","you","he","she","it","we","they","what","which","who","when","where","why","how","and","but","or","not","my","your","his","her","its","our","their"]);

function selectWikiContext(pages: { name: string; content: string }[], query: string, topK = 5): { name: string; content: string }[] {
  const keywords = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  if (keywords.length === 0) return pages.slice(0, topK);
  const scored = pages.map((page) => {
    const haystack = (page.name + " " + page.content).toLowerCase();
    const score = keywords.reduce((acc, kw) => {
      let idx = 0, count = 0;
      while ((idx = haystack.indexOf(kw, idx)) !== -1) { count++; idx += kw.length; }
      return acc + count;
    }, 0);
    return { page, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).filter((s) => s.score > 0).map((s) => s.page);
}

function buildSystemPrompt(pages: { name: string; content: string }[]): string {
  if (pages.length === 0) return "";
  return "You are a helpful assistant with access to the following knowledge base:\n\n" +
    pages.map((p) => `# ${p.name}\n${p.content}`).join("\n\n---\n\n");
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function autoTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 36 ? clean.slice(0, 36) + "…" : clean;
}

function newSession(mode: Mode): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    mode,
    messages: [],
    claudeSessionId: null,
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

const SYS = { fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" };

function getModeColor(mode: Mode, t: Theme): string {
  return mode === "kb" ? t.blue : t.green;
}

function CircleIconButton({ onClick, title, children, t }: {
  onClick: (e: { stopPropagation: () => void }) => void;
  title: string;
  children: ReactNode;
  t: Theme;
}) {
  const bg = t.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const bgHover = t.isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)";
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: bg, border: "none", borderRadius: "50%",
        color: t.label3, cursor: "pointer",
        width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 9, flexShrink: 0, transition: "background 0.1s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = bgHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = bg)}
    >{children}</button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export function KBChatDrawer({ onClose }: Props) {
  const { theme: t } = useTheme();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [wikiPages, setWikiPages] = useState<{ name: string; content: string }[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(540);
  const [chatSettings, setChatSettings] = useState<ChatSettings>({ model: "claude-sonnet-4-6", wikiDir: DEFAULT_WIKI_DIR });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hoveredMode, setHoveredMode] = useState<Mode | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: drawerWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const delta = dragState.current.startX - ev.clientX;
      setDrawerWidth(Math.max(300, Math.min(900, dragState.current.startWidth + delta)));
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const current = sessions.find((s) => s.id === currentId) ?? null;

  // Load wiki pages + persisted sessions + settings on mount
  useEffect(() => {
    window.terminal.getChatSettings().then(setChatSettings);
    window.terminal.loadChatWikiPages().then(setWikiPages);
    window.terminal.loadChatSessions().then((saved) => {
      const typed = saved as ChatSession[];
      if (typed && typed.length > 0) {
        setSessions(typed);
        setCurrentId(typed[0].id);
      } else {
        const s = newSession("kb");
        setSessions([s]);
        setCurrentId(s.id);
      }
    });
  }, []);

  // Persist whenever sessions change, but skip mid-stream to avoid a disk write per chunk
  useEffect(() => {
    if (sessions.length > 0 && !sessions.some((s) => s.messages.some((m) => m.streaming))) {
      window.terminal.saveChatSessions(sessions as unknown[]);
    }
  }, [sessions]);

  // Close settings popover when clicking outside it
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);

  // Escape: close settings popover first, then drawer (only when not loading)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) {
        if (settingsOpen) { setSettingsOpen(false); return; }
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, loading, settingsOpen]);

  // Auto-scroll only when a new message is appended, not on every streaming chunk
  const messageCount = current?.messages.length ?? 0;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount, currentId]);

  const updateSession = useCallback((id: string, updater: (s: ChatSession) => ChatSession) => {
    setSessions((prev) => prev.map((s) => s.id === id ? updater(s) : s));
  }, []);

  const createSession = (mode: Mode = current?.mode ?? "kb") => {
    const s = newSession(mode);
    setSessions((prev) => [s, ...prev]);
    setCurrentId(s.id);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const deleteSession = (id: string) => {
    const fallback = newSession("kb");
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      return next.length === 0 ? [fallback] : next;
    });
    // Side effects outside the updater so they run exactly once
    const next = sessions.filter((s) => s.id !== id);
    if (next.length === 0) {
      setCurrentId(fallback.id);
    } else if (id === currentId) {
      setCurrentId(next[0].id);
    }
  };

  const switchSession = (id: string) => {
    if (loading) return;
    setCurrentId(id);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const stopChat = () => {
    if (currentRequestId) {
      window.terminal.stopChat(currentRequestId);
      setCurrentRequestId(null);
    }
  };

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || loading || !current) return;

    // Slash commands
    if (text === "/clear") {
      updateSession(current.id, (s) => ({ ...s, messages: [], claudeSessionId: null, updatedAt: Date.now() }));
      setInput("");
      return;
    }
    if (text === "/kb" || text === "/code") {
      const nextMode: Mode = text === "/kb" ? "kb" : "code";
      updateSession(current.id, (s) => ({ ...s, mode: nextMode, claudeSessionId: null, updatedAt: Date.now() }));
      setInput("");
      return;
    }

    setInput("");
    setLoading(true);

    const requestId = crypto.randomUUID();
    setCurrentRequestId(requestId);

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text, timestamp: Date.now() };
    const assistantMsg: ChatMessage = { id: requestId, role: "assistant", content: "", streaming: true, timestamp: Date.now() };

    const isFirstMsg = current.messages.length === 0;

    // Selective wiki injection for KB mode on fresh sessions
    let wikiContext: string | undefined;
    if (current.mode === "kb" && !current.claudeSessionId) {
      const topPages = selectWikiContext(wikiPages, text);
      wikiContext = buildSystemPrompt(topPages);
    }

    const sessionId = current.id;
    updateSession(sessionId, (s) => ({
      ...s,
      messages: [...s.messages, userMsg, assistantMsg],
      title: isFirstMsg ? autoTitle(text) : s.title,
      updatedAt: Date.now(),
    }));

    window.terminal.sendChatMessage({
      requestId,
      message: text,
      sessionId: current.claudeSessionId,
      mode: current.mode,
      wikiContext,
      model: chatSettings.model,
    });

    const cleanups: (() => void)[] = [];
    const cleanup = () => { cleanups.forEach((fn) => fn()); setCurrentRequestId(null); };

    cleanups.push(window.terminal.onChatSessionId(requestId, (sid) => {
      updateSession(sessionId, (s) => ({ ...s, claudeSessionId: sid }));
    }));

    cleanups.push(window.terminal.onChatChunk(requestId, (chunk) => {
      updateSession(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => m.id === requestId ? { ...m, content: chunk } : m),
      }));
    }));

    cleanups.push(window.terminal.onChatToolActivity(requestId, (toolName) => {
      updateSession(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => m.id === requestId ? { ...m, toolActivity: toolName } : m),
      }));
    }));

    cleanups.push(window.terminal.onChatUsage(requestId, (usage) => {
      updateSession(sessionId, (s) => ({
        ...s,
        tokenUsage: {
          inputTokens: s.tokenUsage.inputTokens + usage.inputTokens,
          outputTokens: s.tokenUsage.outputTokens + usage.outputTokens,
          cacheReadTokens: s.tokenUsage.cacheReadTokens + usage.cacheReadTokens,
          cacheCreationTokens: s.tokenUsage.cacheCreationTokens + usage.cacheCreationTokens,
        },
      }));
    }));

    cleanups.push(window.terminal.onChatDone(requestId, () => {
      updateSession(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === requestId ? { ...m, streaming: false, toolActivity: undefined } : m
        ),
        updatedAt: Date.now(),
      }));
      setLoading(false);
      cleanup();
      inputRef.current?.focus();
    }));

    cleanups.push(window.terminal.onChatError(requestId, (err) => {
      updateSession(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === requestId ? { ...m, content: `Error: ${err}`, streaming: false, toolActivity: undefined } : m
        ),
        updatedAt: Date.now(),
      }));
      setLoading(false);
      cleanup();
    }));
  }, [input, loading, current, wikiPages, updateSession, chatSettings]);

  const retryLast = () => {
    if (!current || loading) return;
    const lastUser = [...current.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const lastUserIdx = current.messages.lastIndexOf(lastUser);
    updateSession(current.id, (s) => ({
      ...s,
      messages: s.messages.slice(0, lastUserIdx),
      claudeSessionId: null,
    }));
    setInput(lastUser.content);
  };

  const exportChat = () => {
    if (!current || current.messages.length === 0) return;
    const md = `# ${current.title}\n\n` +
      current.messages.map((m) =>
        `**${m.role === "user" ? "You" : "Assistant"}** — ${new Date(m.timestamp).toLocaleString()}\n\n${m.content}`
      ).join("\n\n---\n\n");
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${current.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const filteredSessions = sessions.filter((s) =>
    search === "" || s.title.toLowerCase().includes(search.toLowerCase())
  );

  const lastMsg = current?.messages[current.messages.length - 1];
  const showRetry = !loading && lastMsg?.role === "assistant" && !lastMsg.streaming;
  const totalTokens = current ? current.tokenUsage.inputTokens + current.tokenUsage.outputTokens : 0;

  return (
    <div style={{
      width: drawerWidth, flexShrink: 0,
      background: t.surface1,
      backdropFilter: t.backdropFilter,
      WebkitBackdropFilter: t.backdropFilter,
      borderLeft: `1px solid ${t.border}`,
      display: "flex", flexDirection: "row", position: "relative",
      boxShadow: t.isDark ? "-4px 0 28px rgba(0,0,0,0.6)" : "-4px 0 16px rgba(0,0,0,0.08)",
    }}>
      {/* Resize handle */}
      <div
        onMouseDown={onResizeMouseDown}
        style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 5,
          cursor: "col-resize", zIndex: 10,
          background: "transparent",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = `${t.blue}40`; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      />
      <ChatStyles t={t} />
      {/* Sidebar */}
      {sidebarOpen && (
        <div style={{
          width: 180, flexShrink: 0,
          borderRight: `1px solid ${t.border}`,
          display: "flex", flexDirection: "column",
          background: t.bg,
          backdropFilter: t.backdropFilter,
          WebkitBackdropFilter: t.backdropFilter,
        }}>
          <div style={{
            padding: "8px 8px 6px",
            borderBottom: `1px solid ${t.border}`,
            display: "flex", gap: 4, alignItems: "center",
          }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              style={{
                flex: 1, background: t.surface2, border: `1px solid ${t.borderMid}`,
                borderRadius: 5, color: t.label1, fontSize: 11, padding: "3px 6px",
                outline: "none", ...SYS,
              }}
            />
            <button
              onClick={() => createSession()}
              style={{
                background: `${t.blue}20`, border: `1px solid ${t.blue}40`,
                borderRadius: 5, color: t.blue, cursor: "pointer",
                fontSize: 15, fontWeight: 700, padding: "0px 7px", lineHeight: "20px",
              }}
              title="New chat"
            >+</button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px" }} onMouseLeave={() => setHoveredId(null)}>
            {filteredSessions.map((s) => {
              const mc = getModeColor(s.mode, t);
              const isSelected = s.id === currentId;
              const isHovered = hoveredId === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => switchSession(s.id)}
                  onMouseEnter={() => setHoveredId(s.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    display: "flex", alignItems: "stretch", gap: 6,
                    padding: "7px 8px",
                    marginBottom: 2,
                    borderRadius: 7,
                    background: isSelected
                      ? `${mc}1e`
                      : isHovered ? (t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)") : "none",
                    cursor: "pointer",
                    position: "relative",
                    transition: "background 0.1s",
                  }}
                >
                  {/* Left color indicator */}
                  <div style={{
                    width: 3, borderRadius: 2, flexShrink: 0,
                    background: mc,
                    opacity: isSelected ? 0.9 : 0.5,
                    alignSelf: "stretch",
                  }} />

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0, paddingRight: (isSelected || isHovered) ? 42 : 0 }}>
                    {editingId === s.id ? (
                      <input
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => {
                          if (editingTitle.trim()) updateSession(s.id, (sess) => ({ ...sess, title: editingTitle.trim() }));
                          setEditingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: "100%", background: t.surface2, border: `1px solid ${t.blue}`,
                          borderRadius: 3, color: t.label1, fontSize: 11, padding: "1px 4px",
                          outline: "none", ...SYS,
                        }}
                      />
                    ) : (
                      <>
                        <div
                          onDoubleClick={(e) => { e.stopPropagation(); setEditingId(s.id); setEditingTitle(s.title); }}
                          style={{
                            fontSize: 11, fontWeight: isSelected ? 600 : 400,
                            color: isSelected ? t.label1 : t.label2,
                            lineHeight: 1.4, marginBottom: 2,
                            overflow: "hidden", display: "-webkit-box",
                            WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                            ...SYS,
                          }}
                        >{s.title}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, ...SYS }}>
                          <span style={{ color: mc, fontWeight: 600 }}>
                            {s.mode === "kb" ? "KB" : "Code"}
                          </span>
                          <span style={{ color: t.label4, opacity: 0.5 }}>·</span>
                          <span style={{ color: t.label4 }}>{relativeTime(s.updatedAt)}</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Rename + Delete buttons — visible on hover or selected */}
                  {(isSelected || isHovered) && editingId !== s.id && (
                    <div style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", display: "flex", gap: 2 }}>
                      <CircleIconButton t={t} title="Rename" onClick={(e) => { e.stopPropagation(); setEditingId(s.id); setEditingTitle(s.title); }}>✎</CircleIconButton>
                      <CircleIconButton t={t} title="Delete" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}>✕</CircleIconButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main chat panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "8px 12px", borderBottom: `1px solid ${t.border}`,
          flexShrink: 0, background: t.headerBg,
        }}>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            style={{ background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 13, padding: "2px 4px" }}
            title={sidebarOpen ? "Hide sessions" : "Show sessions"}
          >{sidebarOpen ? "◂" : "▸"}</button>

          <span style={{ fontSize: 12, fontWeight: 700, color: t.label1, ...SYS }}>KB Chat</span>

          <div style={{ flex: 1 }} />

          {totalTokens > 0 && (
            <span style={{
              fontSize: 9, ...SYS,
              color: totalTokens > 16000 ? t.red : totalTokens > 8000 ? t.orange : t.label4,
            }}>
              {(totalTokens / 1000).toFixed(1)}k tok
            </span>
          )}

          {current && current.messages.length > 0 && (
            <button
              onClick={exportChat}
              style={{ background: "none", border: "none", color: t.label4, cursor: "pointer", fontSize: 11, padding: "2px 4px", transition: "color 0.15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = t.label2)}
              onMouseLeave={(e) => (e.currentTarget.style.color = t.label4)}
              title="Export as Markdown"
            >⬇</button>
          )}

          <button
            onClick={() => createSession()}
            style={{
              background: `${t.blue}15`, border: `1px solid ${t.blue}30`,
              borderRadius: 5, color: t.blue, cursor: "pointer",
              fontSize: 10, fontWeight: 700, padding: "2px 8px",
              transition: "all 0.15s", ...SYS,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `${t.blue}28`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `${t.blue}15`; }}
          >New</button>

          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
          >×</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", background: t.bg }}>
          {!current || current.messages.length === 0 ? (
            <EmptyState mode={current?.mode ?? "kb"} t={t} wikiDir={chatSettings.wikiDir} />
          ) : (
            current.messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} t={t} />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Regenerate bar */}
        {showRetry && (
          <div style={{ padding: "4px 12px", borderTop: `1px solid ${t.borderSubtle}`, display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={retryLast}
              style={{
                background: "none", border: `1px solid ${t.borderMid}`,
                borderRadius: 5, color: t.label3, cursor: "pointer",
                fontSize: 10, padding: "2px 8px", ...SYS,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = t.label1)}
              onMouseLeave={(e) => (e.currentTarget.style.color = t.label3)}
            >↺ Regenerate</button>
          </div>
        )}

        {/* Input */}
        <div style={{
          padding: "8px 10px 10px", borderTop: `1px solid ${t.border}`,
          flexShrink: 0, background: t.surface1,
        }}>
          <div style={{
            background: t.surface2,
            border: `1px solid ${t.borderMid}`,
            borderRadius: 12,
          }}>
            {/* Textarea */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                if (e.key === "ArrowUp" && !input && current) {
                  const lastUser = [...current.messages].reverse().find((m) => m.role === "user");
                  if (lastUser) { e.preventDefault(); setInput(lastUser.content); }
                }
              }}
              placeholder={loading ? "Waiting for response…" : "Message…  (⇧↵ newline · ↑ recall)"}
              disabled={loading}
              rows={1}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "none", border: "none",
                color: t.label1, fontSize: 12, padding: "10px 12px 6px",
                outline: "none", resize: "none", lineHeight: 1.5,
                maxHeight: 160, overflowY: "auto",
                opacity: loading ? 0.5 : 1, ...SYS,
              }}
            />

            {/* Bottom toolbar */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px 8px" }}>

              {/* Mode toggle */}
              {current && (
                <div style={{ position: "relative", display: "flex", gap: 1, background: t.surface3, borderRadius: 5, padding: 2, border: `1px solid ${t.borderSubtle}` }}>
                  {(["kb", "code"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      onMouseEnter={() => setHoveredMode(m)}
                      onMouseLeave={() => setHoveredMode(null)}
                      onClick={() => {
                        if (!loading) updateSession(current.id, (s) => ({ ...s, mode: m, claudeSessionId: null, updatedAt: Date.now() }));
                      }}
                      style={{
                        background: current.mode === m ? `${getModeColor(m, t)}28` : "none",
                        border: `1px solid ${current.mode === m ? getModeColor(m, t) + "60" : "transparent"}`,
                        borderRadius: 4,
                        color: current.mode === m ? getModeColor(m, t) : t.label3,
                        cursor: loading ? "not-allowed" : "pointer",
                        fontSize: 10, fontWeight: 700, padding: "1px 7px",
                        transition: "all 0.15s", ...SYS,
                      }}
                    >{m === "kb" ? "KB" : "Code"}</button>
                  ))}
                  {hoveredMode && (
                    <div style={{
                      position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
                      transform: "translateX(-50%)",
                      background: t.surface2, border: `1px solid ${t.borderMid}`,
                      borderRadius: 5, padding: "4px 8px",
                      fontSize: 10, color: t.label2, whiteSpace: "nowrap",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                      pointerEvents: "none", zIndex: 50, ...SYS,
                    }}>
                      {hoveredMode === "kb" ? "Answers from your knowledge base wiki" : "Full repo access via Claude Code tools"}
                    </div>
                  )}
                </div>
              )}

              <div style={{ flex: 1 }} />

              {/* Model picker */}
              <div ref={settingsRef} style={{ position: "relative" }}>
                <button
                  onClick={() => setSettingsOpen((v) => !v)}
                  style={{
                    display: "flex", alignItems: "center", gap: 3,
                    background: settingsOpen ? `${t.label3}15` : "none",
                    border: `1px solid ${settingsOpen ? t.borderMid : "transparent"}`,
                    borderRadius: 6, color: settingsOpen ? t.label2 : t.label3,
                    cursor: "pointer", fontSize: 10, padding: "3px 7px",
                    transition: "all 0.15s", ...SYS,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = t.label1; e.currentTarget.style.borderColor = t.borderSubtle; }}
                  onMouseLeave={(e) => { if (!settingsOpen) { e.currentTarget.style.color = t.label3; e.currentTarget.style.borderColor = "transparent"; } }}
                  title="Model & settings"
                >
                  {MODELS.find((m) => m.id === chatSettings.model)?.label ?? chatSettings.model}
                  <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
                </button>

                {settingsOpen && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0, zIndex: 100,
                    background: t.surface1, border: `1px solid ${t.border}`,
                    borderRadius: 8, padding: "10px 12px", minWidth: 280,
                    boxShadow: t.isDark ? "0 8px 24px rgba(0,0,0,0.5)" : "0 8px 24px rgba(0,0,0,0.12)",
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: t.label3, marginBottom: 8, ...SYS }}>Model</div>
                    {MODELS.map((m) => (
                      <div
                        key={m.id}
                        onClick={() => {
                          const next = { ...chatSettings, model: m.id };
                          setChatSettings(next);
                          window.terminal.saveChatSettings(next);
                        }}
                        style={{
                          padding: "6px 8px", borderRadius: 5, cursor: "pointer", marginBottom: 2,
                          background: chatSettings.model === m.id
                            ? (t.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)")
                            : "none",
                          border: `1px solid ${chatSettings.model === m.id ? t.borderMid : "transparent"}`,
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                        }}
                        onMouseEnter={(e) => { if (chatSettings.model !== m.id) e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"; }}
                        onMouseLeave={(e) => { if (chatSettings.model !== m.id) e.currentTarget.style.background = "none"; }}
                      >
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: t.label1, ...SYS }}>{m.label}</div>
                          <div style={{ fontSize: 10, color: t.label4, ...SYS }}>{m.desc}</div>
                        </div>
                        {chatSettings.model === m.id && <span style={{ color: t.blue, fontSize: 12, fontWeight: 700 }}>✓</span>}
                      </div>
                    ))}
                    <div style={{ borderTop: `1px solid ${t.borderSubtle}`, margin: "10px 0 8px" }} />
                    <div style={{ fontSize: 10, fontWeight: 700, color: t.label3, marginBottom: 6, ...SYS }}>Wiki directory</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        title={chatSettings.wikiDir}
                        style={{
                          flex: 1, fontSize: 10, color: t.label2, ...SYS,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          direction: "rtl", textAlign: "left",
                        }}
                      >{chatSettings.wikiDir || DEFAULT_WIKI_DIR}</span>
                      <button
                        onClick={async () => {
                          const dir = await window.terminal.pickChatWikiDir();
                          if (!dir) return;
                          const next = { ...chatSettings, wikiDir: dir };
                          setChatSettings(next);
                          window.terminal.saveChatSettings(next);
                          window.terminal.loadChatWikiPages().then(setWikiPages).catch(console.error);
                        }}
                        style={{
                          flexShrink: 0,
                          background: t.surface3, border: `1px solid ${t.borderMid}`,
                          borderRadius: 5, color: t.label2, cursor: "pointer",
                          fontSize: 10, padding: "3px 8px", transition: "all 0.15s", ...SYS,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = t.blue)}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = t.borderMid)}
                      >Browse…</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Send / Stop */}
              {loading ? (
                <button
                  onClick={stopChat}
                  style={{
                    background: `${t.red}20`, border: `1px solid ${t.red}40`,
                    borderRadius: 7, color: t.red, cursor: "pointer",
                    fontSize: 11, fontWeight: 700, padding: "4px 9px",
                    flexShrink: 0, lineHeight: 1, ...SYS,
                  }}
                  title="Stop"
                >■</button>
              ) : (
                <button
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  style={{
                    background: !input.trim() ? t.surface3 : t.blue,
                    border: "none", borderRadius: 7,
                    color: !input.trim() ? t.label4 : "#fff",
                    cursor: !input.trim() ? "not-allowed" : "pointer",
                    fontSize: 13, fontWeight: 700, padding: "4px 10px",
                    transition: "all 0.15s", flexShrink: 0, lineHeight: 1, ...SYS,
                  }}
                  title="Send (↵)"
                >↑</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState({ mode, t, wikiDir }: { mode: Mode; t: Theme; wikiDir: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "60px 24px 40px", textAlign: "center", gap: 8,
    }}>
      <div style={{ fontSize: 22, marginBottom: 2 }}>{mode === "kb" ? "📖" : "💻"}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: t.label2, ...SYS }}>
        {mode === "kb" ? "Ask your knowledge base" : "Ask about your codebase"}
      </div>
      <div style={{ fontSize: 11, color: t.label4, lineHeight: 1.6, maxWidth: 220, ...SYS }}>
        {mode === "kb"
          ? `Answers sourced from ${wikiDir}`
          : "Full repo access via Claude Code tools"}
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: t.label4, lineHeight: 1.9, ...SYS }}>
        <span style={{ opacity: 0.6 }}>/clear · /kb · /code · ↑ recall</span>
      </div>
    </div>
  );
}

function MessageBubble({ msg, t }: { msg: ChatMessage; t: Theme }) {
  const isUser = msg.role === "user";
  const [msgCopied, setMsgCopied] = useState(false);
  const copyMessage = () => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setMsgCopied(true);
      setTimeout(() => setMsgCopied(false), 2000);
    });
  };
  return (
    <div style={{ padding: "3px 10px", display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth: isUser ? "90%" : "100%",
        background: isUser
          ? (t.isDark ? "rgba(10,132,255,0.2)" : "rgba(0,122,255,0.12)")
          : t.surface2,
        border: `1px solid ${isUser ? t.blue + "40" : t.borderSubtle}`,
        borderRadius: isUser ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
        padding: "7px 11px",
        fontSize: 12,
        color: t.label1,
        lineHeight: 1.6,
        wordBreak: "break-word",
      }}>
        {isUser ? (
          <span style={{ ...SYS, whiteSpace: "pre-wrap" }}>{msg.content}</span>
        ) : (
          <div style={{ ...SYS }}>
            {msg.streaming && !msg.content ? (
              <TypingDots t={t} toolActivity={msg.toolActivity} />
            ) : (
              <>
                <MarkdownContent body={msg.content} t={t} />
                {msg.streaming && msg.content && (
                  <>
                    {msg.toolActivity && (
                      <div style={{ fontSize: 10, color: t.label4, marginTop: 4, fontStyle: "italic", ...SYS }}>
                        ⚙ {msg.toolActivity}…
                      </div>
                    )}
                    <span style={{
                      display: "inline-block", width: 6, height: 12,
                      background: t.label3, borderRadius: 1, marginLeft: 2,
                      verticalAlign: "text-bottom", animation: "kbc-blink 1s step-end infinite",
                    }} />
                  </>
                )}
              </>
            )}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginTop: 4 }}>
          {!isUser && !msg.streaming && (
            <button
              onClick={copyMessage}
              style={{
                background: msgCopied ? `${t.green}18` : "none",
                border: `1px solid ${msgCopied ? t.green + "50" : t.borderSubtle}`,
                borderRadius: 4,
                color: msgCopied ? t.green : t.label3,
                cursor: "pointer", fontSize: 10, padding: "1px 6px",
                transition: "all 0.15s", ...SYS,
              }}
              onMouseEnter={(e) => { if (!msgCopied) e.currentTarget.style.borderColor = t.borderMid; }}
              onMouseLeave={(e) => { if (!msgCopied) e.currentTarget.style.borderColor = t.borderSubtle; }}
              title="Copy full response"
            >{msgCopied ? "✓ Copied" : "Copy"}</button>
          )}
          <span style={{ fontSize: 9, color: t.label4, ...SYS }}>{relativeTime(msg.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

function TypingDots({ t, toolActivity }: { t: Theme; toolActivity?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ display: "flex", gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            display: "inline-block", width: 5, height: 5, borderRadius: "50%",
            background: t.label3,
            animation: `kbc-dot 1.2s ${i * 0.4}s ease-in-out infinite`,
          }} />
        ))}
      </div>
      {toolActivity && (
        <span style={{ fontSize: 10, color: t.label4, fontStyle: "italic", ...SYS }}>
          ⚙ {toolActivity}
        </span>
      )}
    </div>
  );
}

function ChatStyles({ t }: { t: Theme }) {
  return (
    <style>{`
      @keyframes kbc-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      @keyframes kbc-dot { 0%, 100% { opacity: 0.3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
      .kbc-md h1, .kbc-md h2, .kbc-md h3 { color: ${t.label1}; margin: 8px 0 4px; font-weight: 700; }
      .kbc-md h1 { font-size: 14px; }
      .kbc-md h2 { font-size: 13px; }
      .kbc-md h3 { font-size: 12px; }
      .kbc-md p { margin: 3px 0; }
      .kbc-md ul, .kbc-md ol { padding-left: 16px; margin: 3px 0; }
      .kbc-md li { margin: 1px 0; }
      .kbc-md code { font-family: monospace; font-size: 11px; background: ${t.surface3}; color: ${t.isDark ? t.teal : "#0055CC"}; padding: 1px 4px; border-radius: 3px; }
      .kbc-md pre { background: ${t.surface3}; border: 1px solid ${t.borderSubtle}; border-radius: 6px; padding: 8px; margin: 4px 0; overflow-x: auto; }
      .kbc-md pre code { background: none; padding: 0; color: ${t.label2}; }
      .kbc-md strong { color: ${t.label1}; font-weight: 700; }
      .kbc-md a { color: ${t.blue}; }
      .kbc-md blockquote { border-left: 3px solid ${t.purple}; margin: 4px 0; padding-left: 8px; color: ${t.label3}; }
      .kbc-md hr { border: none; border-top: 1px solid ${t.borderSubtle}; margin: 6px 0; }
      .kbc-md table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 11px; }
      .kbc-md th, .kbc-md td { border: 1px solid ${t.borderMid}; padding: 4px 8px; text-align: left; }
      .kbc-md th { background: ${t.surface3}; color: ${t.label1}; font-weight: 700; }
      .kbc-md tr:nth-child(even) td { background: ${t.isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)"}; }
    `}</style>
  );
}

function CodeBlock({ children, t }: { children: ReactNode; t: Theme }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const copy = () => {
    const text = preRef.current?.textContent ?? "";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div style={{ position: "relative" }}>
      <pre ref={preRef}>{children}</pre>
      <button
        onClick={copy}
        style={{
          position: "absolute", top: 5, right: 5,
          background: copied ? `${t.green}20` : t.surface3,
          border: `1px solid ${copied ? t.green + "50" : t.borderMid}`,
          borderRadius: 4, color: copied ? t.green : t.label3,
          cursor: "pointer", fontSize: 10, padding: "2px 6px",
          transition: "all 0.15s", ...SYS,
        }}
      >{copied ? "✓" : "Copy"}</button>
    </div>
  );
}

function MarkdownContent({ body, t }: { body: string; t: Theme }) {
  return (
    <div className="kbc-md" style={{ fontSize: 12, color: t.label1, lineHeight: 1.7, ...SYS }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ pre: ({ children }) => <CodeBlock t={t}>{children}</CodeBlock> }}
      >{body}</ReactMarkdown>
    </div>
  );
}
