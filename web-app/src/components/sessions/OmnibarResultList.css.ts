import { style } from "@vanilla-extract/css";

export const list = style({
  listStyle: "none",
  margin: 0,
  padding: "4px 0",
  width: "100%",
  maxHeight: "320px",
  overflowY: "auto",
});

export const sectionHeader = style({
  padding: "4px 12px",
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  userSelect: "none",
  listStyle: "none",
});

export const separator = style({
  height: "1px",
  background: "var(--border-color)",
  margin: "4px 0",
  listStyle: "none",
});

export const createNewItem = style({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 12px",
  cursor: "pointer",
  listStyle: "none",
  color: "var(--text-muted)",
  fontStyle: "italic",
  fontSize: "13px",
  transition: "background 0.1s ease",
  borderRadius: "6px",
});

export const createNewHighlighted = style({
  background: "var(--hover-background)",
});

export const createNewIcon = style({
  fontWeight: 700,
  fontStyle: "normal",
  color: "var(--text-secondary)",
  fontSize: "14px",
});
