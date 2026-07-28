import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useTheme, ThemeName } from "../ThemeContext";
import { useSettings, CursorStyle, RendererType } from "../SettingsContext";
import { MONO_FONT, SYS_FONT } from "../theme";
import { RADIUS } from "../chrome";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { theme: t, themeName, setTheme } = useTheme();
  const { settings, update, reset } = useSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  const label: CSSProperties = { color: t.label3, fontSize: 12, fontWeight: 600, ...SYS_FONT };
  const hint: CSSProperties = { color: t.label4, fontSize: 10.5, ...SYS_FONT };
  const field: CSSProperties = {
    background: t.isDark ? "rgba(0,0,0,0.25)" : "#FFFFFF",
    border: `1px solid ${t.borderMid}`, borderRadius: RADIUS,
    color: t.label1, fontSize: 12, padding: "6px 8px", outline: "none",
    ...MONO_FONT, width: 150, textAlign: "right",
  };

  function Row({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "9px 0", borderBottom: `1px solid ${t.borderSubtle}` }}>
        <div style={{ minWidth: 0 }}>
          <div style={label}>{title}</div>
          {sub && <div style={hint}>{sub}</div>}
        </div>
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>{children}</div>
      </div>
    );
  }

  function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
    return (
      <div style={{ display: "flex", background: t.isDark ? "rgba(0,0,0,0.25)" : t.surface2, border: `1px solid ${t.borderMid}`, borderRadius: RADIUS, padding: 2, gap: 2 }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              style={{
                background: active ? t.blue : "none", border: "none", borderRadius: RADIUS,
                color: active ? "#FFFFFF" : t.label3, cursor: "pointer",
                fontSize: 11, fontWeight: active ? 600 : 400, padding: "4px 10px", ...SYS_FONT,
                transition: "all 0.12s",
              }}
            >{o.label}</button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460, maxWidth: "90vw", maxHeight: "85vh", overflowY: "auto",
          background: t.surface1, border: `1px solid ${t.border}`, borderRadius: RADIUS,
          boxShadow: "0 16px 64px rgba(0,0,0,0.5)", padding: "18px 22px 20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ color: t.label1, fontSize: 15, fontWeight: 600, ...SYS_FONT }}>Settings</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: t.label3, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 2 }}
            title="Close (Esc)"
          >×</button>
        </div>

        <div style={{ ...hint, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 10, marginBottom: 2, color: t.label4 }}>Terminal</div>

        <Row title="Font family" sub="Blank = use iTerm2 / default">
          <input
            style={field}
            value={settings.fontFamily}
            placeholder="auto"
            onChange={(e) => update({ fontFamily: e.target.value })}
          />
        </Row>

        <Row title="Font size" sub="0 = auto">
          <input
            style={{ ...field, width: 70 }}
            type="number" min={0} max={72}
            value={settings.fontSize || ""}
            placeholder="auto"
            onChange={(e) => update({ fontSize: parseInt(e.target.value) || 0 })}
          />
        </Row>

        <Row title="Scrollback" sub="Lines kept in buffer">
          <input
            style={{ ...field, width: 90 }}
            type="number" min={100} max={100000} step={1000}
            value={settings.scrollback}
            onChange={(e) => update({ scrollback: Math.max(100, parseInt(e.target.value) || 10000) })}
          />
        </Row>

        <Row title="Cursor style">
          <Seg<CursorStyle>
            value={settings.cursorStyle}
            onChange={(v) => update({ cursorStyle: v })}
            options={[{ value: "bar", label: "Bar" }, { value: "block", label: "Block" }, { value: "underline", label: "Underline" }]}
          />
        </Row>

        <Row title="Cursor blink">
          <Seg<"on" | "off">
            value={settings.cursorBlink ? "on" : "off"}
            onChange={(v) => update({ cursorBlink: v === "on" })}
            options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]}
          />
        </Row>

        <Row title="Renderer" sub="Applies to new terminals">
          <Seg<RendererType>
            value={settings.rendererType}
            onChange={(v) => update({ rendererType: v })}
            options={[{ value: "webgl", label: "GPU" }, { value: "dom", label: "DOM" }]}
          />
        </Row>

        <div style={{ ...hint, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 2, color: t.label4 }}>Layout</div>

        <Row title="Show terminal" sub="Off gives the dock to the file viewer or diff">
          <Seg<"on" | "off">
            value={settings.showTerminal ? "on" : "off"}
            onChange={(v) => update({ showTerminal: v === "on" })}
            options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]}
          />
        </Row>

        <Row title="Match preview" sub="Code line under each search hit">
          <Seg<"on" | "off">
            value={settings.showMatchPreview ? "on" : "off"}
            onChange={(v) => update({ showMatchPreview: v === "on" })}
            options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]}
          />
        </Row>

        <Row title="Nav labels" sub="Captions under the rail icons">
          <Seg<"on" | "off">
            value={settings.showNavLabels ? "on" : "off"}
            onChange={(v) => update({ showNavLabels: v === "on" })}
            options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]}
          />
        </Row>

        <div style={{ ...hint, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 2, color: t.label4 }}>Appearance</div>

        <Row title="Theme">
          <Seg<ThemeName>
            value={themeName}
            onChange={setTheme}
            options={[{ value: "dark", label: "Dark" }, { value: "slack", label: "Slack" }, { value: "light", label: "Light" }]}
          />
        </Row>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
          <button
            onClick={reset}
            style={{ background: "none", border: `1px solid ${t.borderMid}`, borderRadius: RADIUS, color: t.label3, cursor: "pointer", fontSize: 12, padding: "7px 14px", ...SYS_FONT }}
          >Reset to defaults</button>
          <button
            onClick={onClose}
            style={{ background: t.blue, border: "none", borderRadius: RADIUS, color: "#FFFFFF", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "7px 20px", ...SYS_FONT }}
          >Done</button>
        </div>
      </div>
    </div>
  );
}
