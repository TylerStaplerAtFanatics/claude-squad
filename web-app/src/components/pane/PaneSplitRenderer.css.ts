import { style } from "@vanilla-extract/css";
import { vars } from "@/styles/theme.css";

export const resetLayoutButton = style({
  fontSize: vars.fontSize.xs,
  padding: "2px 6px",
  background: "transparent",
  border: `1px solid ${vars.color.borderColor}`,
  borderRadius: vars.radii.sm,
  cursor: "pointer",
  color: vars.color.textMuted,
});
