/**
 * Vanilla-extract theme contract.
 *
 * Maps every design token used in the codebase to a CSS custom property defined
 * in globals.css.  Components that use vanilla-extract (.css.ts files) must import
 * `vars` from here and never use raw `var(--token-name)` strings or hardcoded hex
 * values directly.
 *
 * The contract is intentionally thin — only expose tokens that are actually
 * defined in globals.css and used by components.
 */
import { createTheme, createThemeContract } from "@vanilla-extract/css";

export const vars = createThemeContract({
  color: {
    background: null,
    cardBackground: null,
    hoverBackground: null,
    borderColor: null,
    borderSubtle: null,
    borderMuted: null,

    textPrimary: null,
    textSecondary: null,
    textMuted: null,
    textDisabled: null,
    textTertiary: null,

    primary: null,
    primaryHover: null,
    primaryActive: null,
    primaryText: null,

    success: null,
    successBg: null,
    warning: null,
    warningBg: null,
    error: null,
    errorBg: null,
    errorText: null,

    modalBackground: null,
    modalBorder: null,
    overlayBackground: null,

    inputBackground: null,
    inputBorder: null,
    inputFocusBorder: null,
    inputText: null,

    surfaceSubtle: null,
    surfaceMuted: null,

    accentBg: null,
    accentHover: null,
  },
  statusBadge: {
    approvalBg: null,
    approvalFg: null,
    approvalBorder: null,
    inputBg: null,
    inputFg: null,
    inputBorder: null,
    completeBg: null,
    completeFg: null,
    completeBorder: null,
    uncommittedBg: null,
    uncommittedFg: null,
    uncommittedBorder: null,
    idleBg: null,
    idleFg: null,
    idleBorder: null,
    staleFg: null,
    processingBg: null,
    processingFg: null,
    processingBorder: null,
  },
  space: {
    "1": null,
    "2": null,
    "3": null,
    "4": null,
    "5": null,
    "6": null,
    "8": null,
  },
  fontSize: {
    xs: null,
    sm: null,
    base: null,
    lg: null,
  },
  radii: {
    sm: null,
    md: null,
    lg: null,
    full: null,
  },
  fontMono: null,
});

/**
 * Default theme implementation — maps the contract values to the CSS custom
 * properties defined in globals.css so that the build-time class values resolve
 * to the correct runtime variables.
 */
export const defaultTheme = createTheme(vars, {
  color: {
    background: "var(--background)",
    cardBackground: "var(--card-background)",
    hoverBackground: "var(--hover-background)",
    borderColor: "var(--border-color)",
    borderSubtle: "var(--border-subtle)",
    borderMuted: "var(--border-muted)",

    textPrimary: "var(--text-primary)",
    textSecondary: "var(--text-secondary)",
    textMuted: "var(--text-muted)",
    textDisabled: "var(--text-disabled)",
    textTertiary: "var(--text-tertiary)",

    primary: "var(--primary)",
    primaryHover: "var(--primary-hover)",
    primaryActive: "var(--primary-active)",
    primaryText: "var(--primary-text)",

    success: "var(--success)",
    successBg: "var(--success-bg)",
    warning: "var(--warning)",
    warningBg: "var(--warning-bg)",
    error: "var(--error)",
    errorBg: "var(--error-bg)",
    errorText: "var(--error-text)",

    modalBackground: "var(--modal-background)",
    modalBorder: "var(--modal-border)",
    overlayBackground: "var(--overlay-background)",

    inputBackground: "var(--input-background)",
    inputBorder: "var(--input-border)",
    inputFocusBorder: "var(--input-focus-border)",
    inputText: "var(--input-text)",

    surfaceSubtle: "var(--surface-subtle)",
    surfaceMuted: "var(--surface-muted)",

    accentBg: "var(--accent-bg)",
    accentHover: "var(--accent-hover)",
  },
  statusBadge: {
    approvalBg: "var(--status-badge-approval-bg)",
    approvalFg: "var(--status-badge-approval-fg)",
    approvalBorder: "var(--status-badge-approval-border)",
    inputBg: "var(--status-badge-input-bg)",
    inputFg: "var(--status-badge-input-fg)",
    inputBorder: "var(--status-badge-input-border)",
    completeBg: "var(--status-badge-complete-bg)",
    completeFg: "var(--status-badge-complete-fg)",
    completeBorder: "var(--status-badge-complete-border)",
    uncommittedBg: "var(--status-badge-uncommitted-bg)",
    uncommittedFg: "var(--status-badge-uncommitted-fg)",
    uncommittedBorder: "var(--status-badge-uncommitted-border)",
    idleBg: "var(--status-badge-idle-bg)",
    idleFg: "var(--status-badge-idle-fg)",
    idleBorder: "var(--status-badge-idle-border)",
    staleFg: "var(--status-badge-stale-fg)",
    processingBg: "var(--status-badge-processing-bg)",
    processingFg: "var(--status-badge-processing-fg)",
    processingBorder: "var(--status-badge-processing-border)",
  },
  space: {
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "5": "20px",
    "6": "24px",
    "8": "32px",
  },
  fontSize: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.125rem",
  },
  radii: {
    sm: "4px",
    md: "6px",
    lg: "8px",
    full: "9999px",
  },
  fontMono: "var(--font-mono)",
});
