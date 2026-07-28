import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./ThemeContext";
import { SettingsProvider } from "./SettingsContext";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </ThemeProvider>
);
