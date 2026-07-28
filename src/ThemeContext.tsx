import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Theme, darkTheme, slackTheme, lightTheme, breezeTheme } from "./theme";

const THEME_KEY = "td_theme";
const REDESIGN_KEY = "td_theme_breeze_migrated";

export type ThemeName = "breeze" | "dark" | "slack" | "light";
const themes: Record<ThemeName, Theme> = { breeze: breezeTheme, dark: darkTheme, slack: slackTheme, light: lightTheme };
const cycle: ThemeName[] = ["breeze", "dark", "slack", "light"];

interface ThemeContextValue {
  theme: Theme;
  themeName: ThemeName;
  toggleTheme: () => void;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: darkTheme,
  themeName: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(() => {
    try {
      // Breeze is the redesign, not an extra option — move existing installs across once,
      // then respect whatever the user picks afterwards.
      if (!localStorage.getItem(REDESIGN_KEY)) {
        localStorage.setItem(REDESIGN_KEY, "1");
        localStorage.setItem(THEME_KEY, "breeze");
        return "breeze";
      }
      const stored = localStorage.getItem(THEME_KEY);
      return (stored && stored in themes ? stored : "breeze") as ThemeName;
    } catch {
      return "breeze";
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

  const setTheme = (name: ThemeName) => {
    try { localStorage.setItem(THEME_KEY, name); } catch {}
    setThemeName(name);
  };

  return (
    <ThemeContext.Provider value={{ theme, themeName, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
