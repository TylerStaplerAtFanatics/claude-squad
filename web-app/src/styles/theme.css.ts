import { createTheme } from "@vanilla-extract/css";
import { vars } from "./theme-contract.css";

export { vars } from "./theme-contract.css";

const sharedTokens = {
  font: {
    mono: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  space: {
    "0": "0px",
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "6": "24px",
    "8": "32px",
    "12": "48px",
    "16": "64px",
  },
  radii: {
    sm: "4px",
    md: "6px",
    lg: "12px",
    full: "9999px",
  },
  fontSize: {
    xs: "11px",
    sm: "12px",
    base: "14px",
    lg: "16px",
    xl: "20px",
  },
};

const terminalTokens = {
  terminalBackground: "#1e1e1e",
  terminalForeground: "#d4d4d4",
  terminalBorder: "#3e3e42",
  terminalHeaderBg: "#2d2d30",
  terminalHeaderFg: "#ffffff",
  terminalTabsBg: "#252526",
  terminalTextMuted: "#9ca3af",
  terminalHoverBg: "#3e3e42",
};

export const lightTheme = createTheme(vars, {
  color: {
    textPrimary: "#0a0a0a",
    textSecondary: "#4a4a4a",
    textMuted: "#6b6b6b",
    textDisabled: "#9a9a9a",
    textTertiary: "#9ca3af",
    textInverse: "#ffffff",

    background: "#ffffff",
    cardBackground: "#f9f9f9",
    hoverBackground: "#f0f0f0",
    modalBackground: "#ffffff",
    overlayBackground: "rgba(0, 0, 0, 0.5)",
    panelBgSecondary: "#f3f4f6",
    surfaceSubtle: "#f9fafb",
    surfaceMuted: "#f3f4f6",

    borderColor: "#e0e0e0",
    borderSubtle: "#e5e7eb",
    borderMuted: "#d1d5db",
    borderStrong: "#9ca3af",
    borderHover: "#9ca3af",
    modalBorder: "#e0e0e0",
    inputBorder: "#d4d4d4",
    inputFocusBorder: "#0070f3",

    primary: "#0070f3",
    primaryHover: "#0051cc",
    primaryActive: "#003d99",
    primaryDark: "#003d99",
    primaryText: "#ffffff",

    success: "#10b981",
    successBg: "#d1fae5",
    warning: "#f59e0b",
    warningBg: "#fef3c7",
    warningText: "#92400e",
    error: "#ef4444",
    errorBg: "#fee2e2",
    errorText: "#991b1b",
    errorDark: "#b91c1c",

    accentBg: "rgba(0, 112, 243, 0.08)",
    accentHover: "rgba(0, 112, 243, 0.16)",

    inputBackground: "#ffffff",
    inputText: "#0a0a0a",
    placeholderColor: "#9ca3af",

    ...terminalTokens,
  },
  ...sharedTokens,
});

export const darkTheme = createTheme(vars, {
  color: {
    textPrimary: "#ededed",
    textSecondary: "#b4b4b4",
    textMuted: "#8a8a8a",
    textDisabled: "#767676",
    textTertiary: "#6b7280",
    textInverse: "#0a0a0a",

    background: "#0a0a0a",
    cardBackground: "#1a1a1a",
    hoverBackground: "#2a2a2a",
    modalBackground: "#1a1a1a",
    overlayBackground: "rgba(0, 0, 0, 0.7)",
    panelBgSecondary: "#2a2a2a",
    surfaceSubtle: "#1f2937",
    surfaceMuted: "#374151",

    borderColor: "#333333",
    borderSubtle: "#374151",
    borderMuted: "#4b5563",
    borderStrong: "#6b7280",
    borderHover: "#6b7280",
    modalBorder: "#333333",
    inputBorder: "#404040",
    inputFocusBorder: "#2d9cdb",

    primary: "#2d9cdb",
    primaryHover: "#3ba9e6",
    primaryActive: "#52b9f0",
    primaryDark: "#1a7fc1",
    primaryText: "#ffffff",

    success: "#10b981",
    successBg: "#064e3b",
    warning: "#f59e0b",
    warningBg: "#78350f",
    warningText: "#fbbf24",
    error: "#ef4444",
    errorBg: "#7f1d1d",
    errorText: "#fca5a5",
    errorDark: "#ef4444",

    accentBg: "rgba(45, 156, 219, 0.1)",
    accentHover: "rgba(45, 156, 219, 0.2)",

    inputBackground: "#2a2a2a",
    inputText: "#ededed",
    placeholderColor: "#6b7280",

    ...terminalTokens,
  },
  ...sharedTokens,
});
