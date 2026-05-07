"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "cockpit.sessionListSplit";
const RATIO_KEY = "cockpit.sessionListSplitRatio";
const DEFAULT_RATIO = 0.5;

export function useSessionListSplit(): {
  isSplit: boolean;
  splitRatio: number;
  toggleSplit: () => void;
  setSplitRatio: (r: number) => void;
} {
  const [isSplit, setIsSplit] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [splitRatio, setSplitRatioState] = useState(() => {
    if (typeof localStorage === "undefined") return DEFAULT_RATIO;
    try {
      const s = localStorage.getItem(RATIO_KEY);
      if (s) {
        const v = parseFloat(s);
        if (!isNaN(v) && v >= 0.15 && v <= 0.85) return v;
      }
    } catch {
      // ignore
    }
    return DEFAULT_RATIO;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(isSplit));
    } catch {
      // ignore
    }
  }, [isSplit]);

  const toggleSplit = useCallback(() => setIsSplit((v) => !v), []);

  const setSplitRatio = useCallback((r: number) => {
    const clamped = Math.max(0.15, Math.min(0.85, r));
    setSplitRatioState(clamped);
    try {
      localStorage.setItem(RATIO_KEY, String(clamped));
    } catch {
      // ignore
    }
  }, []);

  return { isSplit, splitRatio, toggleSplit, setSplitRatio };
}
