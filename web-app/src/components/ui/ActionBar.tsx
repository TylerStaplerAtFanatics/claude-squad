"use client";

import {
  actionBar,
  gapSm,
  gapMd,
  gapLg,
  justifyStart,
  justifyEnd,
  justifyBetween,
  justifyCenter,
  scroll as scrollClass,
} from "./ActionBar.css";

interface ActionBarProps {
  children: React.ReactNode;
  gap?: "sm" | "md" | "lg";
  justify?: "start" | "end" | "between" | "center";
  /** On small screens, keep items in one row and allow horizontal scroll instead of wrapping */
  scroll?: boolean;
  className?: string;
}

const gapClass = {
  sm: gapSm,
  md: gapMd,
  lg: gapLg,
} as const;

const justifyClass = {
  start: justifyStart,
  end: justifyEnd,
  between: justifyBetween,
  center: justifyCenter,
} as const;

export function ActionBar({ children, gap = "md", justify = "start", scroll, className }: ActionBarProps) {
  const classes = [
    actionBar,
    gapClass[gap],
    justifyClass[justify],
    scroll ? scrollClass : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={classes}>{children}</div>;
}
