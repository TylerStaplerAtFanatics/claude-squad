/**
 * Typed theme contract that wraps the CSS custom properties defined in globals.css.
 * Import `vars` from here instead of using raw `var(--token-name)` strings in .css.ts files.
 *
 * @see globals.css for the authoritative list of defined tokens.
 */
import { createGlobalThemeContract } from "@vanilla-extract/css";

/**
 * Maps each token name to its CSS custom property name in globals.css.
 * The factory `(value) => `--${value}`` produces e.g. `--success` from `"success"`.
 */
export const vars = createGlobalThemeContract(
  {
    color: {
      success: "success",
      warning: "warning",
      error: "error",
      primary: "primary",
      textPrimary: "text-primary",
      textSecondary: "text-secondary",
      background: "background",
      cardBackground: "card-background",
      borderColor: "border-color",
    },
    statusBadge: {
      approvalBg: "status-badge-approval-bg",
      approvalFg: "status-badge-approval-fg",
      approvalBorder: "status-badge-approval-border",
      inputBg: "status-badge-input-bg",
      inputFg: "status-badge-input-fg",
      inputBorder: "status-badge-input-border",
      completeBg: "status-badge-complete-bg",
      completeFg: "status-badge-complete-fg",
      completeBorder: "status-badge-complete-border",
      uncommittedBg: "status-badge-uncommitted-bg",
      uncommittedFg: "status-badge-uncommitted-fg",
      uncommittedBorder: "status-badge-uncommitted-border",
      idleBg: "status-badge-idle-bg",
      idleFg: "status-badge-idle-fg",
      idleBorder: "status-badge-idle-border",
      staleFg: "status-badge-stale-fg",
      processingBg: "status-badge-processing-bg",
      processingFg: "status-badge-processing-fg",
      processingBorder: "status-badge-processing-border",
    },
  },
  (value) => `--${value}`
);
