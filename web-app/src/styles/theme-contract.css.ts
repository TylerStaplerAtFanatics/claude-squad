import { createThemeContract } from "@vanilla-extract/css";

export const vars = createThemeContract({
  color: {
    // Text
    textPrimary: null,
    textSecondary: null,
    textMuted: null,
    textDisabled: null,
    textTertiary: null,
    textInverse: null,

    // Surfaces / backgrounds
    background: null,
    cardBackground: null,
    hoverBackground: null,
    modalBackground: null,
    overlayBackground: null,
    panelBgSecondary: null,
    surfaceSubtle: null,
    surfaceMuted: null,

    // Borders
    borderColor: null,
    borderSubtle: null,
    borderMuted: null,
    borderStrong: null,
    borderHover: null,
    modalBorder: null,
    inputBorder: null,
    inputFocusBorder: null,

    // Primary action
    primary: null,
    primaryHover: null,
    primaryActive: null,
    primaryDark: null,
    primaryText: null,

    // Status
    success: null,
    successBg: null,
    warning: null,
    warningBg: null,
    warningText: null,
    error: null,
    errorBg: null,
    errorText: null,
    errorDark: null,

    // Accent tints
    accentBg: null,
    accentHover: null,

    // Inputs
    inputBackground: null,
    inputText: null,
    placeholderColor: null,

    // Terminal (always dark — same value in both themes)
    terminalBackground: null,
    terminalForeground: null,
    terminalBorder: null,
    terminalHeaderBg: null,
    terminalHeaderFg: null,
    terminalTabsBg: null,
    terminalTextMuted: null,
    terminalHoverBg: null,
  },
  font: {
    mono: null,
    sans: null,
  },
  space: {
    "0": null,
    "1": null,
    "2": null,
    "3": null,
    "4": null,
    "6": null,
    "8": null,
    "12": null,
    "16": null,
  },
  radii: {
    sm: null,
    md: null,
    lg: null,
    full: null,
  },
  fontSize: {
    xs: null,
    sm: null,
    base: null,
    lg: null,
    xl: null,
  },
});
