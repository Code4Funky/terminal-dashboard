export const SYS_FONT = { fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif" };

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
  bg: "#1c1c1e",
  surface1: "#1c1c1e",
  surface2: "#2c2c2e",
  surface3: "#3a3a3c",
  headerBg: "rgba(28,28,30,0.96)",
  backdropFilter: "blur(20px) saturate(180%)",
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
  bg: "#f5f5f7",
  surface1: "#ffffff",
  surface2: "#ffffff",
  surface3: "#f0f0f5",
  headerBg: "rgba(255,255,255,0.96)",
  backdropFilter: "blur(20px) saturate(180%)",
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
