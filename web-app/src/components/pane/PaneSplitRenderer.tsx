"use client";

import { useRef } from "react";
import type { Session } from "@/gen/session/v1/types_pb";
import { SessionDetail } from "@/components/sessions/SessionDetail";
import type { PaneNode, LeafPane, SplitPane, PaneState, PaneAction, PaneId, SessionDetailTab } from "@/lib/pane/paneTypes";
import { getAllLeaves } from "@/lib/pane/paneReducer";
import { PaneHeader } from "./PaneHeader";
import { ResizeHandle } from "./ResizeHandle";
import { MobilePaneTabStrip } from "./MobilePaneTabStrip";
import { useViewport } from "@/components/providers/ViewportProvider";
import { containsPaneId, hasVerticalSplit } from "@/lib/pane/paneUtils";
import {
  splitContainer,
  leafContainer,
  leafZoomed,
  emptyPaneSlot,
  paneBody,
} from "@/styles/pane/paneSplit.css";

interface PaneSplitRendererProps {
  state: PaneState;
  dispatch: React.Dispatch<PaneAction>;
  sessions: Session[];
}

interface PaneNodeProps {
  node: PaneNode;
  state: PaneState;
  dispatch: React.Dispatch<PaneAction>;
  sessions: Session[];
  isMobile: boolean;
  hasSplits: boolean;
}

function PaneNodeComponent({ node, state, dispatch, sessions, isMobile, hasSplits }: PaneNodeProps) {
  if (node.type === "leaf") {
    return (
      <PaneLeafComponent
        pane={node}
        state={state}
        dispatch={dispatch}
        sessions={sessions}
        hasSplits={hasSplits}
      />
    );
  }

  return (
    <PaneSplitComponent
      pane={node}
      state={state}
      dispatch={dispatch}
      sessions={sessions}
      isMobile={isMobile}
      hasSplits={hasSplits}
    />
  );
}

interface PaneSplitProps {
  pane: SplitPane;
  state: PaneState;
  dispatch: React.Dispatch<PaneAction>;
  sessions: Session[];
  isMobile: boolean;
  hasSplits: boolean;
}

function PaneSplitComponent({ pane, state, dispatch, sessions, isMobile, hasSplits }: PaneSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // On mobile: vertical (side-by-side) splits collapse to the focused pane only.
  // Horizontal (top/bottom) splits are fine on mobile — show both panes stacked.
  if (isMobile && pane.direction === "vertical") {
    const focusedInFirst = containsPaneId(pane.first, state.focusedPaneId);
    const visibleNode = focusedInFirst ? pane.first : pane.second;
    return (
      <PaneNodeComponent
        node={visibleNode}
        state={state}
        dispatch={dispatch}
        sessions={sessions}
        isMobile={isMobile}
        hasSplits={hasSplits}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={splitContainer({ direction: pane.direction })}
      style={{ "--split-ratio": String(pane.ratio) } as React.CSSProperties}
    >
      <PaneNodeComponent
        node={pane.first}
        state={state}
        dispatch={dispatch}
        sessions={sessions}
        isMobile={isMobile}
        hasSplits={hasSplits}
      />
      <ResizeHandle
        splitId={pane.id}
        direction={pane.direction}
        onResize={(splitId: PaneId, ratio: number) =>
          dispatch({ type: "RESIZE_PANE", splitId, ratio })
        }
      />
      <PaneNodeComponent
        node={pane.second}
        state={state}
        dispatch={dispatch}
        sessions={sessions}
        isMobile={isMobile}
        hasSplits={hasSplits}
      />
    </div>
  );
}

interface PaneLeafProps {
  pane: LeafPane;
  state: PaneState;
  dispatch: React.Dispatch<PaneAction>;
  sessions: Session[];
  hasSplits: boolean;
}

function PaneLeafComponent({ pane, state, dispatch, sessions, hasSplits }: PaneLeafProps) {
  const isFocused = state.focusedPaneId === pane.id;
  const isZoomed = state.zoomedPaneId === pane.id;
  const session = pane.sessionId
    ? sessions.find((s) => s.id === pane.sessionId) ?? null
    : null;

  const handleFocus = () => dispatch({ type: "FOCUS_PANE", paneId: pane.id });
  const handleClose = () => dispatch({ type: "CLOSE_PANE", paneId: pane.id });
  const handleZoom = () => dispatch({ type: "ZOOM_PANE", paneId: pane.id });
  const handleTabChange = (tab: SessionDetailTab) =>
    dispatch({ type: "ASSIGN_TAB", paneId: pane.id, tab });
  const handleSplitVertical = () =>
    dispatch({ type: "SPLIT_PANE", paneId: pane.id, direction: "vertical" });

  return (
    <div
      className={`${leafContainer({ focused: isFocused && hasSplits })}${isZoomed ? ` ${leafZoomed}` : ""}`}
      data-focused={isFocused ? "true" : "false"}
      data-testid={`pane-leaf-${pane.id}`}
      data-context="cockpit"
      onClick={handleFocus}
    >
      <PaneHeader
        pane={pane}
        sessions={sessions}
        isFocused={isFocused}
        onClose={handleClose}
        onFocus={handleFocus}
        onTabChange={handleTabChange}
        onZoom={handleZoom}
        splitButtonVisible={true}
        onSplitVertical={handleSplitVertical}
      />
      <div className={paneBody}>
        {session ? (
          <SessionDetail
            key={`${pane.id}-${pane.sessionId}`}
            session={session}
            onClose={handleClose}
            onFullscreenChange={() => {}}
            onTabChange={handleTabChange}
            initialTab={pane.activeTab}
            embedded={true}
          />
        ) : (
          <div className={emptyPaneSlot}>
            Click a session to open it here
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * PaneSplitRenderer — root renderer for the pane tree.
 * Renders the full recursive pane layout.
 */
export function PaneSplitRenderer({ state, dispatch, sessions }: PaneSplitRendererProps) {
  const { isMobile, isFoldable } = useViewport();
  // Collapse split panes for any viewport below 900px (mobile + foldable) — BottomNav is
  // visible there and single-pane + MobilePaneTabStrip gives a better UX than cramped splits.
  const isNarrow = isMobile || isFoldable;
  const allLeaves = getAllLeaves(state.root);
  const hasMultiplePanes = allLeaves.length > 1;
  // Tab strip only needed when vertical (side-by-side) splits exist — those get collapsed
  // to one pane on mobile and need a tab strip to switch. Horizontal (stacked) splits
  // show both panes and don't need a tab strip.
  const showMobileTabStrip = isNarrow && hasMultiplePanes && hasVerticalSplit(state.root);

  return (
    <div
      style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}
      data-context="cockpit"
    >
      {/* Reset layout button — only shown when there is a split layout */}
      {hasMultiplePanes && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "2px 4px", flexShrink: 0, background: "transparent" }}>
          <button
            data-testid="reset-layout-btn"
            style={{
              fontSize: "11px",
              padding: "2px 6px",
              background: "transparent",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
              cursor: "pointer",
              color: "var(--text-muted)",
            }}
            onClick={() => dispatch({ type: "RESET_LAYOUT" })}
            title="Reset to single pane"
          >
            Reset layout
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "hidden", minHeight: 0, position: "relative" }}>
        <PaneNodeComponent
          node={state.root}
          state={state}
          dispatch={dispatch}
          sessions={sessions}
          isMobile={isNarrow}
          hasSplits={hasMultiplePanes}
        />
      </div>

      {showMobileTabStrip && (
        <MobilePaneTabStrip
          leaves={allLeaves}
          focusedPaneId={state.focusedPaneId}
          sessions={sessions}
          onFocus={(paneId: PaneId) => dispatch({ type: "FOCUS_PANE", paneId })}
        />
      )}
    </div>
  );
}
