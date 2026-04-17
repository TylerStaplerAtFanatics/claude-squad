import { style, styleVariants } from "@vanilla-extract/css";
import { vars } from "@/styles/theme.css";

/** Container for the terminal snapshot preview section */
export const snapshotSection = style({
  margin: "8px 0 0",
  borderRadius: 6,
  overflow: "hidden",
  border: `1px solid ${vars.color.borderColor}`,
});

/** Toggle button row */
export const snapshotToggle = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "4px 10px",
  background: vars.color.cardBackground,
  border: "none",
  cursor: "pointer",
  width: "100%",
  fontSize: "0.7rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: vars.color.textSecondary,
  userSelect: "none",
  ":hover": {
    opacity: 0.85,
  },
  ":focus-visible": {
    outline: `2px solid ${vars.color.primary}`,
    outlineOffset: -2,
  },
});

export const snapshotToggleIcon = style({
  fontSize: "0.65rem",
  lineHeight: 1,
});

/** Fixed-height preview pane */
export const snapshotPane = style({
  height: 200,
  overflowY: "auto",
  padding: "6px 10px",
  fontFamily: '"Menlo", "Monaco", "Courier New", monospace',
  fontSize: "0.72rem",
  lineHeight: 1.5,
  background: "#1e1e1e",
  color: "#d4d4d4",
  whiteSpace: "pre-wrap",
});

/** Placeholder shown when terminal was cleared */
export const snapshotEmpty = style({
  height: 120,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "0.75rem",
  color: vars.color.textSecondary,
  background: vars.color.cardBackground,
  fontStyle: "italic",
});

/** Loading skeleton */
export const snapshotLoading = style({
  height: 120,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "0.75rem",
  color: vars.color.textSecondary,
  background: vars.color.cardBackground,
});

/** Error state */
export const snapshotError = styleVariants({
  base: {
    height: 120,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.72rem",
    color: vars.color.error,
    background: vars.color.cardBackground,
    padding: "0 10px",
    textAlign: "center",
  },
});
