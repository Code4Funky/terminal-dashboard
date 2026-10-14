import type { CSSProperties } from "react";
import type { Theme } from "./theme";
import { SYS_FONT, MONO_FONT, TABULAR } from "./theme";

/**
 * Shared panel chrome. Every panel takes its separation from a 1px border plus a background
 * step — never a coloured outline, which is what made the old UI read as four separate apps.
 */

export const RADIUS = 3;
export const RADIUS_SM = 2;
export const TRANSITION = "background 200ms linear, color 200ms linear, box-shadow 200ms linear";

/** A docked panel. `side` is the edge that carries the separator. */
export function panel(t: Theme, side: "left" | "right" | "none" = "none"): CSSProperties {
  return {
    background: t.surface1,
    ...(side === "left" ? { borderLeft: `1px solid ${t.border}` } : {}),
    ...(side === "right" ? { borderRight: `1px solid ${t.border}` } : {}),
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  };
}

/** 34px panel header. Title is 10px uppercase; trailing controls stay pinned. */
export function panelHeader(t: Theme): CSSProperties {
  return {
    height: 34,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 8px 0 12px",
    borderBottom: `1px solid ${t.borderMid}`,
    background: t.surface1,
  };
}

export function panelTitle(t: Theme): CSSProperties {
  return {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    fontWeight: 600,
    color: t.label2,
    ...SYS_FONT,
  };
}

/** 38px drawer header. Overlays get a 13px sentence-case title, not a panel's 10px caps.
 *  minHeight, not height — a few drawers carry a second summary line. */
export function drawerHeader(t: Theme): CSSProperties {
  return {
    minHeight: 38,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 10px 0 14px",
    borderBottom: `1px solid ${t.border}`,
    background: t.headerBg,
  };
}

export function drawerTitle(t: Theme): CSSProperties {
  return { fontSize: 13, fontWeight: 600, color: t.label1, ...CLIP, ...SYS_FONT };
}

/** Group label inside a list — e.g. `AGENTS · 3`, or a folder path above search hits. */
export function sectionLabel(t: Theme, accent = false): CSSProperties {
  return {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    fontWeight: 600,
    color: accent ? t.teal : t.label3,
    padding: "12px 12px 6px",
    ...SYS_FONT,
    ...TABULAR,
  };
}

/**
 * The one selection treatment: fill plus an inset left accent bar. Applied to rail items,
 * session rows, search hits and the active code line alike.
 */
export function rowState(t: Theme, selected: boolean, hovered = false): CSSProperties {
  return {
    background: selected ? t.selectedBg : hovered ? t.surface2 : "transparent",
    boxShadow: selected ? `inset 2px 0 0 ${t.blue}` : "none",
    transition: TRANSITION,
  };
}

/** 2px accent ring, 1px offset — keyboard focus only. */
export function focusRing(t: Theme): CSSProperties {
  return { outline: `2px solid ${t.blue}`, outlineOffset: 1, borderRadius: RADIUS };
}

/** Small accent-tinted count chip. */
export function chip(t: Theme, tone: "accent" | "neutral" = "neutral"): CSSProperties {
  return {
    fontSize: 10,
    lineHeight: "16px",
    padding: "0 5px",
    borderRadius: RADIUS_SM,
    background: tone === "accent" ? t.selectedBg : t.surface2,
    color: tone === "accent" ? t.teal : t.label2,
    border: `1px solid ${tone === "accent" ? t.blue + "40" : t.borderSubtle}`,
    flexShrink: 0,
    whiteSpace: "nowrap",
    ...MONO_FONT,
    ...TABULAR,
  };
}

export type DotState = "running" | "needs-input" | "idle";

/** Status dot; running gets a halo so it reads as live at a glance. */
export function dot(t: Theme, state: DotState): CSSProperties {
  const color = state === "running" ? t.green : state === "needs-input" ? t.orange : t.label4;
  return {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
    boxShadow: state === "running" ? `0 0 0 3px ${color}33` : "none",
  };
}

/** Ellipsize from the LEFT, so a branch keeps its ticket ID and a path keeps its filename. */
export const CLIP_LEFT: CSSProperties = {
  direction: "rtl",
  textAlign: "left",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

export const CLIP: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

/** Mono metadata line — branch names, shas, paths. */
export function meta(t: Theme, size = 11): CSSProperties {
  return { fontSize: size, color: t.label3, ...MONO_FONT, ...TABULAR };
}
