import { style } from "@vanilla-extract/css";
import { vars } from "@/styles/theme.css";

export const actionBar = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--action-bar-gap, 0.5rem)",
});

export const gapSm = style({ vars: { "--action-bar-gap": "0.25rem" } as Record<string, string> });
export const gapMd = style({ vars: { "--action-bar-gap": "0.5rem" } as Record<string, string> });
export const gapLg = style({ vars: { "--action-bar-gap": "0.75rem" } as Record<string, string> });

export const justifyStart = style({ justifyContent: "flex-start" });
export const justifyEnd = style({ justifyContent: "flex-end" });
export const justifyBetween = style({ justifyContent: "space-between" });
export const justifyCenter = style({ justifyContent: "center" });

export const scroll = style({
  "@media": {
    "screen and (max-width: 640px)": {
      flexWrap: "nowrap",
      overflowX: "auto",
      WebkitOverflowScrolling: "touch" as "touch",
      scrollbarWidth: "none",
      selectors: {
        "&::-webkit-scrollbar": {
          display: "none",
        },
        "& > *": {
          flexShrink: 0,
        },
      },
    },
  },
});
