import { style } from "@vanilla-extract/css";
import { keyframes } from "@vanilla-extract/css";
import { vars } from "@/styles/theme.css";

const fadeIn = keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

export const pickerOverlay = style({
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.55)",
  zIndex: 20,
  cursor: "pointer",
  animation: `${fadeIn} 80ms ease`,
});

export const pickerLabel = style({
  width: "56px",
  height: "56px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: vars.radii.lg,
  background: vars.color.primary,
  color: vars.color.primaryText,
  fontSize: "28px",
  fontWeight: vars.fontWeight.bold,
  fontFamily: vars.font.mono,
  boxShadow: vars.shadow.lg,
  pointerEvents: "none",
  userSelect: "none",
});
