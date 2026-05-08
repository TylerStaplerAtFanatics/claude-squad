"use client";

import { useRef, useEffect } from "react";
import type { Session } from "@/gen/session/v1/types_pb";
import { usePaneReducer } from "@/lib/pane/usePaneReducer";
import { usePaneShortcuts } from "@/lib/pane/usePaneShortcuts";
import { getAllLeaves, findLeaf } from "@/lib/pane/paneReducer";
import { PaneSplitRenderer } from "./PaneSplitRenderer";
import { PaneContext } from "./PaneContext";

interface PaneTilingContainerProps {
  sessions: Session[];
  /**
   * When set, the session with this id is assigned to the currently focused pane.
   * The `version` field must change each time an assignment should fire (even for
   * the same session), so callers should increment a counter.
   */
  externalSessionAssign?: {
    sessionId: string;
    tab?: "terminal" | "diff" | "vcs" | "logs" | "info" | "files";
    version: number;
  } | null;
}

/**
 * PaneTilingContainer — top-level tiling layout component.
 *
 * Holds the pane reducer state, wires keyboard shortcuts, persists layout,
 * and renders the recursive pane tree via PaneSplitRenderer.
 */
export function PaneTilingContainer({
  sessions,
  externalSessionAssign,
}: PaneTilingContainerProps) {
  const [state, dispatch] = usePaneReducer(sessions);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevVersionRef = useRef<number | null>(null);
  // Tracks the most recently focused session-detail pane so session clicks from
  // a session-list pane still open in the last explicitly focused detail pane.
  const lastFocusedDetailPaneRef = useRef<string | null>(null);

  // Register keyboard shortcuts
  usePaneShortcuts(state, dispatch, containerRef);

  // Keep lastFocusedDetailPaneRef current whenever focus moves to a detail pane.
  useEffect(() => {
    const leaf = findLeaf(state.root, state.focusedPaneId);
    if (leaf && leaf.viewKind === "session-detail") {
      lastFocusedDetailPaneRef.current = state.focusedPaneId;
    }
  }, [state.focusedPaneId, state.root]);

  // When externalSessionAssign.version changes, route the session to the best detail pane:
  // 1. The focused pane (if it is a session-detail pane)
  // 2. The last explicitly focused session-detail pane (preserved across list-pane clicks)
  // 3. The first session-detail pane in tree order (fallback)
  useEffect(() => {
    if (!externalSessionAssign) return;
    if (externalSessionAssign.version === prevVersionRef.current) return;
    prevVersionRef.current = externalSessionAssign.version;

    const focusedLeaf = findLeaf(state.root, state.focusedPaneId);
    let targetPaneId: string = state.focusedPaneId;
    if (!focusedLeaf || focusedLeaf.viewKind === "session-list") {
      const allLeaves = getAllLeaves(state.root);
      const lastDetail = lastFocusedDetailPaneRef.current
        ? allLeaves.find((l) => l.id === lastFocusedDetailPaneRef.current && l.viewKind === "session-detail")
        : null;
      const firstDetail = allLeaves.find((l) => l.viewKind === "session-detail");
      targetPaneId = (lastDetail ?? firstDetail)?.id ?? state.focusedPaneId;
    }

    dispatch({ type: "ASSIGN_SESSION", paneId: targetPaneId, sessionId: externalSessionAssign.sessionId });
    if (externalSessionAssign.tab) {
      dispatch({ type: "ASSIGN_TAB", paneId: targetPaneId, tab: externalSessionAssign.tab });
    }
  }, [externalSessionAssign, dispatch, state.root, state.focusedPaneId]);

  return (
    <PaneContext.Provider value={{ state, dispatch, sessions }}>
      <div
        ref={containerRef}
        style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}
        data-context="cockpit"
      >
        <PaneSplitRenderer
          state={state}
          dispatch={dispatch}
          sessions={sessions}
        />
      </div>
    </PaneContext.Provider>
  );
}
