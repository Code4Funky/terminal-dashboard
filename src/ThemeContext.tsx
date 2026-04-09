import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Theme, darkTheme, lightTheme } from "./theme";

const THEME_KEY = "td_theme";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: darkTheme,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return stored ? stored === "dark" : true; // dark by default
    } catch {
      return true;
    }
  });

  const theme = isDark ? darkTheme : lightTheme;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    document.body.style.background = theme.bg;
  }, [isDark, theme.bg]);

  const toggleTheme = () => {
    setIsDark((v) => {
      const next = !v;
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
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
