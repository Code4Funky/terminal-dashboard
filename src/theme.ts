export interface Theme {
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

export const lightTheme: Theme = {
  isDark: false,
  bg: "#F2F2F7",
  surface1: "#FFFFFF",
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
