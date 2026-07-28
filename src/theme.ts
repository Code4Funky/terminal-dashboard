export const SYS_FONT = { fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" };
export const MONO_FONT = { fontFamily: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace" };
/** Counts, durations and line numbers must not jitter as digits change. */
export const TABULAR = { fontVariantNumeric: "tabular-nums" as const };

export interface Theme {
  name: "dark" | "slack" | "light" | "breeze";
  isDark: boolean;
  // Backgrounds
  bg: string;        // App canvas
  surface0: string;  // Recessed — inputs, code well
  surface1: string;  // Panel
  surface2: string;  // Panel raised / row hover
  surface3: string;  // Elevated above raised
  headerBg: string;  // Drawer header overlay
  backdropFilter: string; // Frosted-glass blur
  selectedBg: string; // Selection fill — pairs with an inset accent bar, never an outline
  matchBg: string;    // Search-match highlight
  // Borders
  border: string;    // Separator-strength border
  borderMid: string; // Normal border
  borderSubtle: string; // Subtle border
  // Labels
  label1: string;    // Primary text
  label2: string;    // Secondary text
  label3: string;    // Tertiary text
  label4: string;    // Quaternary / disabled text
  // System accent colors (iOS/macOS differ dark vs light)
  blue: string;
  green: string;
  orange: string;
  red: string;
  purple: string;
  teal: string;
}

export const darkTheme: Theme = {
  name: "dark",
  isDark: true,
  bg: "#1c1c1e",
  surface0: "#141416",
  surface1: "#1c1c1e",
  surface2: "#2c2c2e",
  surface3: "#3a3a3c",
  headerBg: "rgba(28,28,30,0.96)",
  backdropFilter: "blur(20px) saturate(180%)",
  selectedBg: "rgba(10,132,255,0.16)",
  matchBg: "rgba(10,132,255,0.28)",
  border: "rgba(84,84,88,0.55)",
  borderMid: "rgba(84,84,88,0.4)",
  borderSubtle: "rgba(84,84,88,0.25)",
  label1: "#FFFFFF",
  label2: "rgba(235,235,245,0.6)",
  label3: "rgba(235,235,245,0.5)",
  label4: "rgba(235,235,245,0.28)",
  blue: "#0A84FF",
  green: "#30D158",
  orange: "#FF9F0A",
  red: "#FF453A",
  purple: "#BF5AF2",
  teal: "#5AC8FA",
};

export const slackTheme: Theme = {
  name: "slack",
  isDark: true,
  bg: "rgba(26,29,33,0.85)",
  surface0: "rgba(18,20,24,0.92)",
  surface1: "rgba(25,23,29,0.90)",
  surface2: "rgba(34,37,41,0.85)",
  surface3: "rgba(44,45,48,0.90)",
  headerBg: "rgba(26,29,33,0.85)",
  backdropFilter: "blur(20px) saturate(180%)",
  selectedBg: "rgba(29,155,209,0.18)",
  matchBg: "rgba(29,155,209,0.30)",
  border: "#3D3F44",
  borderMid: "#313339",
  borderSubtle: "#282A2E",
  label1: "#E8E8E8",
  label2: "#ABABAD",
  label3: "#7A7B7C",
  label4: "#5E5F61",
  blue: "#1D9BD1",
  green: "#2BAC76",
  orange: "#E8912D",
  red: "#E01E5A",
  purple: "#6C37C9",
  teal: "#1BA8A8",
};

// Skedulo Breeze, adapted to dark. Single accent hue — purple/teal fold onto accent-bright
// rather than introducing hues Breeze doesn't have. Separation is carried by 1px borders
// and background steps; no shadows, gradients or blur on inline panels.
export const breezeTheme: Theme = {
  name: "breeze",
  isDark: true,
  bg: "#0e1626",
  surface0: "#101a2c",
  surface1: "#131c2e",
  surface2: "#1b263a",
  surface3: "#222e45",
  headerBg: "#131c2e",
  backdropFilter: "none",
  selectedBg: "#0f2a45",
  matchBg: "#0d3a63",
  border: "#2b3853",
  borderMid: "#232f47",
  borderSubtle: "#1e2942",
  label1: "#e4e7ed",
  label2: "#9aa2b2",
  label3: "#7a8291",
  label4: "#5e687a",
  blue: "#008cff",
  green: "#6ebf81",
  orange: "#e99149",
  red: "#e0736a",
  purple: "#66baff",
  teal: "#33a3ff",
};

export const lightTheme: Theme = {
  name: "light",
  isDark: false,
  bg: "#f5f5f7",
  surface0: "#ebebf0",
  surface1: "#ffffff",
  surface2: "#ffffff",
  surface3: "#f0f0f5",
  headerBg: "rgba(255,255,255,0.96)",
  backdropFilter: "blur(20px) saturate(180%)",
  selectedBg: "rgba(0,122,255,0.12)",
  matchBg: "rgba(0,122,255,0.22)",
  border: "rgba(60,60,67,0.18)",
  borderMid: "rgba(60,60,67,0.14)",
  borderSubtle: "rgba(60,60,67,0.08)",
  label1: "#000000",
  label2: "rgba(60,60,67,0.75)",
  label3: "rgba(60,60,67,0.55)",
  label4: "rgba(60,60,67,0.35)",
  blue: "#007AFF",
  green: "#34C759",
  orange: "#FF9500",
  red: "#FF3B30",
  purple: "#AF52DE",
  teal: "#32ADE6",
};
