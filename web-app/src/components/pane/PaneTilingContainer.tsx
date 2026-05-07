"use client";

import { useRef, useEffect } from "react";
import type { Session } from "@/gen/session/v1/types_pb";
import { usePaneReducer } from "@/lib/pane/usePaneReducer";
import { usePaneShortcuts } from "@/lib/pane/usePaneShortcuts";
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

  // Register keyboard shortcuts
  usePaneShortcuts(state, dispatch, containerRef);

  // When externalSessionAssign.version changes, route the session to the focused pane
  useEffect(() => {
    if (!externalSessionAssign) return;
    if (externalSessionAssign.version === prevVersionRef.current) return;
    prevVersionRef.current = externalSessionAssign.version;

    dispatch({ type: "ASSIGN_SESSION", paneId: state.focusedPaneId, sessionId: externalSessionAssign.sessionId });
    if (externalSessionAssign.tab) {
      dispatch({ type: "ASSIGN_TAB", paneId: state.focusedPaneId, tab: externalSessionAssign.tab });
    }
  }, [externalSessionAssign, dispatch, state.focusedPaneId]);

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
