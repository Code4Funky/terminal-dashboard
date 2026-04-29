export interface Theme {
  name: "dark" | "slack" | "light";
  isDark: boolean;
  // Backgrounds
  bg: string;        // App base
  surface1: string;  // Toolbar, drawer panels
  surface2: string;  // Cards
  surface3: string;  // Card hover / elevated
  headerBg: string;  // Drawer header overlay
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
  bg: "#000000",
  surface1: "#1C1C1E",
  surface2: "#2C2C2E",
  surface3: "#3A3A3C",
  headerBg: "rgba(0,0,0,0.35)",
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
  bg: "#1A1D21",
  surface1: "#19171D",
  surface2: "#222529",
  surface3: "#2C2D30",
  headerBg: "rgba(26,29,33,0.85)",
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
  bg: "#F2F2F7",
  surface1: "#F8F8F8",
  surface2: "#F2F2F7",
  surface3: "#E5E5EA",
  headerBg: "rgba(242,242,247,0.7)",
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
