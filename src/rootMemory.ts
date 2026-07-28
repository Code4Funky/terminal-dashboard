import type { FileRef } from "./components/FileTreeModal";

/** Per-root file-browser state, so switching terminals parks a root rather than losing it. */
export interface RootState {
  expanded: string[];
  file: FileRef | null;
}

const KEY = "tdash:file-roots";
const MAX_ROOTS = 20;
const EMPTY: RootState = { expanded: [], file: null };

function readAll(): Record<string, RootState> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function loadRoot(root: string): RootState {
  const s = readAll()[root];
  return s ? { expanded: s.expanded ?? [], file: s.file ?? null } : EMPTY;
}

export function saveRoot(root: string, patch: Partial<RootState>): void {
  const all = readAll();
  const prev = all[root] ?? EMPTY;
  delete all[root]; // re-insert last, so the trim below evicts the least-recently-touched root
  const next: Record<string, RootState> = { ...all, [root]: { ...prev, ...patch } };
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ROOTS))) delete next[k];
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota — losing tree state is harmless */ }
}
