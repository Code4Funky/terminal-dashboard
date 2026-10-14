import { createContext, useContext, useState, ReactNode } from "react";

export type CursorStyle = "bar" | "block" | "underline";
export type RendererType = "webgl" | "dom";

export interface Settings {
  fontFamily: string; // "" = auto (iTerm2 / built-in default)
  fontSize: number;   // 0 = auto
  scrollback: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  rendererType: RendererType;
  showTerminal: boolean;      // off → terminals collapse and the right dock fills
  showMatchPreview: boolean;  // preview line under each search hit
  showNavLabels: boolean;     // 9px captions under the nav-rail icons
}

export const DEFAULT_SETTINGS: Settings = {
  fontFamily: "",
  fontSize: 0,
  scrollback: 10000,
  cursorStyle: "bar",
  cursorBlink: true,
  rendererType: "webgl",
  showTerminal: true,
  showMatchPreview: true,
  showNavLabels: true,
};

const SETTINGS_KEY = "td_settings";

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  update: () => {},
  reset: () => {},
});

function load(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);

  const update = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const reset = () => {
    try { localStorage.removeItem(SETTINGS_KEY); } catch {}
    setSettings(DEFAULT_SETTINGS);
  };

  return (
    <SettingsContext.Provider value={{ settings, update, reset }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
