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
  },
  (value) => `--${value}`
);
