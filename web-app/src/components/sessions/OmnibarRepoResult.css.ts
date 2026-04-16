import { style } from "@vanilla-extract/css";

export const row = style({
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "8px 12px",
  cursor: "pointer",
  borderRadius: "6px",
  listStyle: "none",
  userSelect: "none",
  transition: "background 0.1s",
  background: "transparent",
});

export const rowHighlighted = style({
  background: "var(--accent-bg)",
});

export const folderIcon = style({
  flexShrink: 0,
  color: "var(--text-muted)",
  display: "flex",
  alignItems: "center",
});

export const content = style({
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "2px",
});

export const pathLine = style({
  display: "flex",
  alignItems: "baseline",
  gap: "2px",
  overflow: "hidden",
  whiteSpace: "nowrap",
});

export const parentPath = style({
  fontSize: "13px",
  color: "var(--text-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  flexShrink: 1,
  minWidth: 0,
});

export const separator = style({
  fontSize: "13px",
  color: "var(--text-muted)",
  flexShrink: 0,
});

export const repoName = style({
  fontSize: "13px",
  fontWeight: 600,
  color: "var(--text-primary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  flexShrink: 0,
});

export const sessionCount = style({
  fontSize: "11px",
  color: "var(--text-muted)",
});

export const relativeTime = style({
  fontSize: "11px",
  color: "var(--text-muted)",
  flexShrink: 0,
  marginLeft: "auto",
  whiteSpace: "nowrap",
});
