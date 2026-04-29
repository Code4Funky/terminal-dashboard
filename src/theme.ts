export interface Theme {
  name: "dark" | "slack" | "light";
  isDark: boolean;
  // Backgrounds
  bg: string;        // App base
  surface1: string;  // Toolbar, drawer panels
  surface2: string;  // Cards
  surface3: string;  // Card hover / elevated
  headerBg: string;  // Drawer header overlay
  backdropFilter: string; // Frosted-glass blur
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
  bg: "rgba(0,0,0,0.82)",
  surface1: "rgba(28,28,30,0.88)",
  surface2: "rgba(44,44,46,0.82)",
  surface3: "rgba(58,58,60,0.90)",
  headerBg: "rgba(0,0,0,0.35)",
  backdropFilter: "blur(20px) saturate(180%)",
  border: "rgba(84,84,88,0.65)",
  borderMid: "rgba(84,84,88,0.5)",
  borderSubtle: "rgba(84,84,88,0.35)",
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
  surface1: "rgba(25,23,29,0.90)",
  surface2: "rgba(34,37,41,0.85)",
  surface3: "rgba(44,45,48,0.90)",
  headerBg: "rgba(26,29,33,0.85)",
  backdropFilter: "blur(20px) saturate(180%)",
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

export const lightTheme: Theme = {
  name: "light",
  isDark: false,
  bg: "rgba(242,242,247,0.72)",
  surface1: "rgba(248,248,248,0.82)",
  surface2: "rgba(240,240,242,0.80)",
  surface3: "rgba(229,229,234,0.85)",
  headerBg: "rgba(242,242,247,0.70)",
  backdropFilter: "blur(20px) saturate(180%)",
  border: "rgba(60,60,67,0.29)",
  borderMid: "rgba(60,60,67,0.2)",
  borderSubtle: "rgba(60,60,67,0.12)",
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
