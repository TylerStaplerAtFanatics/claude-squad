"use client";

import type { Session } from "@/gen/session/v1/types_pb";
import type { LeafPane, SessionDetailTab, PaneViewKind } from "@/lib/pane/paneTypes";
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
  onSetView?: (viewKind: PaneViewKind) => void;
  splitButtonVisible?: boolean;
  onSplitVertical?: () => void;
  onSplitHorizontal?: () => void;
}

export function PaneHeader({
  pane,
  sessions,
  isFocused: _isFocused,
  onClose,
  onFocus,
  onTabChange,
  onZoom,
  onSetView,
  splitButtonVisible,
  onSplitVertical,
  onSplitHorizontal,
}: PaneHeaderProps) {
  const isListPane = pane.viewKind === "session-list";
  const session = !isListPane && pane.sessionId
    ? sessions.find((s) => s.id === pane.sessionId) ?? null
    : null;
  const titleText = isListPane ? "Sessions" : (session ? session.title : "Empty");

  return (
    <div
      className={paneHeader}
      data-testid={`pane-header-${pane.id}`}
      onClick={onFocus}
    >
      <span className={paneTitle} title={titleText}>
        {titleText}
      </span>

      {/* Tab switcher buttons (only for session-detail panes with a session) */}
      {!isListPane && session &&
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

      {/* View-kind toggle: cycle between session-list and session-detail */}
      {onSetView && (
        <button
          className={paneHeaderButton}
          data-testid="pane-view-toggle-btn"
          onClick={(e) => {
            e.stopPropagation();
            onSetView(isListPane ? "session-detail" : "session-list");
          }}
          title={isListPane ? "Switch to session detail" : "Switch to session list"}
          aria-label={isListPane ? "Switch to session detail" : "Switch to session list"}
        >
          {isListPane ? "⊡" : "☰"}
        </button>
      )}

      {/* Split buttons */}
      {splitButtonVisible && (
        <>
          <button
            className={paneHeaderButton}
            data-testid="pane-split-vertical-btn"
            onClick={(e) => {
              e.stopPropagation();
              onSplitVertical?.();
            }}
            title="Split pane side by side (vertical)"
            aria-label="Split pane side by side"
          >
            ⊟
          </button>
          <button
            className={paneHeaderButton}
            data-testid="pane-split-horizontal-btn"
            onClick={(e) => {
              e.stopPropagation();
              onSplitHorizontal?.();
            }}
            title="Split pane top and bottom (horizontal)"
            aria-label="Split pane top and bottom"
          >
            ⊠
          </button>
        </>
      )}

      {/* Zoom button (only for session-detail) */}
      {!isListPane && (
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
      )}

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
