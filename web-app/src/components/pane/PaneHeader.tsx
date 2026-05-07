"use client";

import type { Session } from "@/gen/session/v1/types_pb";
import type { LeafPane, SessionDetailTab } from "@/lib/pane/paneTypes";
import {
  paneHeader,
  paneTitle,
  paneHeaderButton,
  paneCloseButton,
  paneTabButton,
} from "@/styles/pane/paneHeader.css";

const TAB_LABELS: Record<SessionDetailTab, string> = {
  terminal: "Term",
  diff: "Diff",
  vcs: "VCS",
  logs: "Logs",
  info: "Info",
  files: "Files",
};

const TAB_FULL_LABELS: Record<SessionDetailTab, string> = {
  terminal: "Terminal",
  diff: "Diff",
  vcs: "Version Control",
  logs: "Logs",
  info: "Session Info",
  files: "Files",
};

const ALL_TABS: SessionDetailTab[] = ["terminal", "diff", "vcs", "logs", "info", "files"];

interface PaneHeaderProps {
  pane: LeafPane;
  sessions: Session[];
  isFocused: boolean;
  onClose: () => void;
  onFocus: () => void;
  onTabChange: (tab: SessionDetailTab) => void;
  onZoom: () => void;
  splitButtonVisible?: boolean;
  onSplitVertical?: () => void;
}

export function PaneHeader({
  pane,
  sessions,
  isFocused: _isFocused,
  onClose,
  onFocus,
  onTabChange,
  onZoom,
  splitButtonVisible,
  onSplitVertical,
}: PaneHeaderProps) {
  const session = pane.sessionId
    ? sessions.find((s) => s.id === pane.sessionId) ?? null
    : null;
  const titleText = session ? session.title : "Empty";

  return (
    <div
      className={paneHeader}
      data-testid={`pane-header-${pane.id}`}
      onClick={onFocus}
    >
      <span className={paneTitle} title={titleText}>
        {titleText}
      </span>

      {/* Tab switcher buttons (only show when pane has a session) */}
      {session &&
        ALL_TABS.map((tab) => (
          <button
            key={tab}
            className={paneTabButton({ active: pane.activeTab === tab })}
            onClick={(e) => {
              e.stopPropagation();
              onTabChange(tab);
            }}
            title={TAB_FULL_LABELS[tab]}
            aria-label={`Switch to ${TAB_FULL_LABELS[tab]} tab`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}

      {/* Split vertical button */}
      {splitButtonVisible && (
        <button
          className={paneHeaderButton}
          data-testid="pane-split-vertical-btn"
          onClick={(e) => {
            e.stopPropagation();
            onSplitVertical?.();
          }}
          title="Split pane vertically"
          aria-label="Split pane vertically"
        >
          ⊟
        </button>
      )}

      {/* Zoom button */}
      <button
        className={paneHeaderButton}
        onClick={(e) => {
          e.stopPropagation();
          onZoom();
        }}
        title="Zoom pane"
        aria-label="Zoom pane"
      >
        ⊞
      </button>

      {/* Close button */}
      <button
        className={paneCloseButton}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close pane"
        aria-label="Close pane"
      >
        ✕
      </button>
    </div>
  );
}
