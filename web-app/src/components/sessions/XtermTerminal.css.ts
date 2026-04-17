import { style, globalStyle } from "@vanilla-extract/css";
import { vars } from "@/styles/theme.css";

export const container = style({
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  background: vars.color.cardBackground,
  borderRadius: "4px",
  overflow: "hidden",
  boxSizing: "border-box",
});

export const terminal = style({
  flex: 1,
  width: "100%",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
  position: "relative",
  boxSizing: "content-box",
  padding: 0,
  margin: 0,
});

// Global styles for xterm.js elements within the terminal container
globalStyle(`${terminal} .xterm`, {
  height: "100% !important",
  width: "100% !important",
  padding: "0 !important",
  margin: "0 !important",
  boxSizing: "content-box !important",
});

globalStyle(`${terminal} .xterm-screen`, {
  height: "100% !important",
  width: "100% !important",
  boxSizing: "content-box !important",
  padding: "0 !important",
  margin: "0 !important",
});

globalStyle(`${terminal} .xterm-rows`, {
  boxSizing: "content-box !important",
});

globalStyle(`${terminal} .xterm-viewport`, {
  overflowY: "hidden",
  scrollbarWidth: "thin",
  scrollbarColor: "rgba(255, 255, 255, 0.2) transparent",
});

globalStyle(`${terminal} .xterm-viewport::-webkit-scrollbar`, {
  width: "8px",
});

globalStyle(`${terminal} .xterm-viewport::-webkit-scrollbar-track`, {
  background: "transparent",
});

globalStyle(`${terminal} .xterm-viewport::-webkit-scrollbar-thumb`, {
  backgroundColor: "rgba(255, 255, 255, 0.2)",
  borderRadius: "4px",
});

globalStyle(`${terminal} .xterm-viewport::-webkit-scrollbar-thumb:hover`, {
  backgroundColor: "rgba(255, 255, 255, 0.3)",
});

globalStyle(`${terminal} .xterm-selection`, {
  backgroundColor: "rgba(255, 255, 255, 0.3)",
});

globalStyle(`${terminal} .xterm:focus`, {
  outline: "2px solid rgba(33, 150, 243, 0.5)",
  outlineOffset: "-2px",
});
