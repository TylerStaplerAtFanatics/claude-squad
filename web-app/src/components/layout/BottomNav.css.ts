import { style } from "@vanilla-extract/css";
import { vars } from "@/styles/theme.css";

export const nav = style({
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  display: "flex",
  background: vars.color.background,
  borderTop: `1px solid ${vars.color.borderColor}`,
  zIndex: 1050,
  paddingBottom: "var(--safe-area-bottom, 0px)",

  // Only show below 900px (mobile + foldable range)
  "@media": {
    "(min-width: 900px)": {
      display: "none",
    },
  },
});

export const navItem = style({
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "64px",
  fontSize: vars.fontSize.xs,
  color: vars.color.textSecondary,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: `${vars.space["2"]} ${vars.space["1"]}`,
  transition: "color 0.15s, background 0.15s",
  textDecoration: "none",
  gap: vars.space["1"],

  selectors: {
    "&:hover": {
      color: vars.color.textPrimary,
      background: vars.color.hoverBackground,
    },
  },
});

export const navItemActive = style({
  color: vars.color.primary,

  selectors: {
    "&:hover": {
      color: vars.color.primaryHover,
    },
  },
});

export const navItemIcon = style({
  fontSize: vars.fontSize.lg,
  lineHeight: "1",
});

export const navItemLabel = style({
  fontSize: vars.fontSize.xs,
  fontWeight: "500",
});
