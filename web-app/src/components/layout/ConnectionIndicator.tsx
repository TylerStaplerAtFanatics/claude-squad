"use client";

import { useAppSelector } from "@/lib/store";
import { selectConnectionState, type ConnectionState } from "@/lib/store/sessionsSlice";
import { button, dots, labels } from "./ConnectionIndicator.css";

const STATE_LABEL: Record<ConnectionState, string> = {
  connected: "Live",
  stale: "Stale",
  disconnected: "Offline",
};

const STATE_ARIA: Record<ConnectionState, string> = {
  connected: "Live — session data is up to date",
  stale: "Stale — session data may be outdated. Click to refresh",
  disconnected: "Offline — reconnecting. Click to reload",
};

export function ConnectionIndicator() {
  const connectionState = useAppSelector(selectConnectionState);
  const isActionable = connectionState !== "connected";

  const handleClick = () => {
    if (isActionable) {
      window.location.reload();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <button
      className={button}
      aria-label={STATE_ARIA[connectionState]}
      title={STATE_ARIA[connectionState]}
      onClick={isActionable ? handleClick : undefined}
      onKeyDown={isActionable ? handleKeyDown : undefined}
      disabled={!isActionable}
      aria-live="polite"
    >
      <span
        className={dots[connectionState]}
        aria-hidden="true"
      />
      <span className={labels[connectionState]}>
        {STATE_LABEL[connectionState]}
      </span>
    </button>
  );
}
