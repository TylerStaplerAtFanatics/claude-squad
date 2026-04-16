import { style, styleVariants } from "@vanilla-extract/css";

export const row = style({
  display: "flex",
  flexDirection: "row",
  alignItems: "flex-start",
  gap: "10px",
  padding: "8px 12px",
  cursor: "pointer",
  borderRadius: "6px",
  width: "100%",
  listStyle: "none",
  background: "transparent",
  transition: "background 0.1s ease",
});

export const rowHighlighted = style({
  background: "var(--hover-background)",
});

export const dotWrapper = style({
  display: "flex",
  alignItems: "center",
  paddingTop: "3px",
  flexShrink: 0,
});

export const dot = style({
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  flexShrink: 0,
  display: "inline-block",
});

export const dotVariants = styleVariants({
  running: { background: "var(--success)" },
  paused: { background: "var(--warning)" },
  active: { background: "var(--primary)" },
  default: { background: "var(--text-muted)" },
});

export const content = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  flex: 1,
});

export const titleRow = style({
  display: "flex",
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "8px",
  minWidth: 0,
});

export const title = style({
  fontWeight: 600,
  color: "var(--text-primary)",
  fontSize: "14px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
  flex: 1,
});

export const branch = style({
  color: "var(--text-muted)",
  fontSize: "12px",
  flexShrink: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "140px",
});

export const path = style({
  color: "var(--text-tertiary)",
  fontSize: "11px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  marginTop: "1px",
});
