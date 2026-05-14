import { style } from "@vanilla-extract/css";
import { vars } from "@/styles/theme.css";

export const pageRoot = style({
  display: "flex",
  flexDirection: "column",
  height: "100%",
  maxWidth: "800px",
  margin: "0 auto",
  padding: `${vars.space[4]} ${vars.space[4]} 0`,
});
