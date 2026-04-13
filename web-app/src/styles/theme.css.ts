/**
 * Typed wrappers around the global CSS custom properties defined in globals.css.
 * Use these in .css.ts files instead of hardcoding hex values or raw var() strings.
 *
 * When globals.css gains a new token, add the corresponding entry here so
 * vanilla-extract components can reference it in a type-safe way.
 */
export const vars = {
  color: {
    primary: "var(--primary)",
    primaryHover: "var(--primary-hover)",

    textPrimary: "var(--text-primary)",
    textSecondary: "var(--text-secondary)",
    textMuted: "var(--text-muted)",
    textDisabled: "var(--text-disabled)",

    background: "var(--background)",
    cardBackground: "var(--card-background)",
    hoverBackground: "var(--hover-background)",

    borderColor: "var(--border-color)",

    success: "var(--success)",
    successBg: "var(--success-bg)",
    warning: "var(--warning)",
    warningBg: "var(--warning-bg)",
    error: "var(--error)",
    errorBg: "var(--error-bg)",
  },
  font: {
    mono: "var(--font-mono)",
  },
} as const;
