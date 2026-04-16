"use client";

import styles from "./ActionBar.module.css";

interface ActionBarProps {
  children: React.ReactNode;
  gap?: "sm" | "md" | "lg";
  justify?: "start" | "end" | "between" | "center";
  /** On small screens, keep items in one row and allow horizontal scroll instead of wrapping */
  scroll?: boolean;
  className?: string;
}

const gapClass = {
  sm: styles.gapSm,
  md: styles.gapMd,
  lg: styles.gapLg,
} as const;

const justifyClass = {
  start: styles.justifyStart,
  end: styles.justifyEnd,
  between: styles.justifyBetween,
  center: styles.justifyCenter,
} as const;

export function ActionBar({ children, gap = "md", justify = "start", scroll, className }: ActionBarProps) {
  const classes = [
    styles.actionBar,
    gapClass[gap],
    justifyClass[justify],
    scroll ? styles.scroll : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={classes}>{children}</div>;
}
