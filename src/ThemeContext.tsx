import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Theme, darkTheme, slackTheme, lightTheme } from "./theme";

const THEME_KEY = "td_theme";

type ThemeName = "dark" | "slack" | "light";
const themes: Record<ThemeName, Theme> = { dark: darkTheme, slack: slackTheme, light: lightTheme };
const cycle: ThemeName[] = ["dark", "slack", "light"];

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: darkTheme,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return (stored && stored in themes ? stored : "dark") as ThemeName;
    } catch {
      return "dark";
    }
  });

  const theme = themes[themeName];

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeName);
    document.body.style.background = "transparent";
    window.terminal.setBackgroundColor("#00000000");
  }, [themeName, theme.bg]);

  const toggleTheme = () => {
    setThemeName((v) => {
      const next = cycle[(cycle.indexOf(v) + 1) % cycle.length];
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
