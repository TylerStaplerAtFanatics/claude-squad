"use client";

import { useReducer, useEffect, useRef } from "react";
import { PaneState, PaneAction } from "./paneTypes";
import { paneReducer, initialPaneState, getAllLeaves, findLeaf } from "./paneReducer";
import { savePaneLayout, clearPaneLayout, loadPaneLayout, validateAndRepair } from "./usePaneLayout";

interface SessionLike {
  id: string;
}

/**
 * usePaneReducer — wraps useReducer(paneReducer) with localStorage persistence.
 *
 * On first render with non-null sessions: loads and restores the saved layout.
 * On every state change: debounces a save to localStorage.
 * On RESET_LAYOUT: clears localStorage.
 */
export function usePaneReducer(
  sessions: SessionLike[] | null
): [PaneState, React.Dispatch<PaneAction>] {
  const [state, dispatch] = useReducer(paneReducer, undefined, initialPaneState);
  const restoredRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore layout once sessions first become available
  useEffect(() => {
    if (sessions === null) return;
    if (restoredRef.current) return;
    restoredRef.current = true;

    const layout = loadPaneLayout();
    if (!layout) return;

    const validIds = new Set(sessions.map((s) => s.id));
    const repairedRoot = validateAndRepair(layout.root, validIds);

    // Pre-tiling layouts have no session-list pane. Discard them so the user
    // gets the default split layout rather than a grid of empty detail panes.
    const allLeaves = getAllLeaves(repairedRoot);
    const hasListPane = allLeaves.some((l) => l.viewKind === "session-list");
    if (!hasListPane) {
      clearPaneLayout();
      return;
    }

    // Ensure focusedPaneId still exists in the repaired tree
    const focusedStillExists = allLeaves.some((l) => l.id === layout.focusedPaneId);
    const focusedPaneId = focusedStillExists
      ? layout.focusedPaneId
      : allLeaves[0]?.id ?? layout.focusedPaneId;

    // Ensure zoomedPaneId still exists
    const zoomedPaneId = layout.zoomedPaneId !== null && findLeaf(repairedRoot, layout.zoomedPaneId)
      ? layout.zoomedPaneId
      : null;

    dispatch({
      type: "RESTORE_LAYOUT",
      state: { root: repairedRoot, focusedPaneId, zoomedPaneId },
    });
  }, [sessions]);

  // Re-validate when sessions change (sessions deleted externally)
  useEffect(() => {
    if (sessions === null) return;
    if (!restoredRef.current) return;

    const validIds = new Set(sessions.map((s) => s.id));
    const allLeaves = getAllLeaves(state.root);
    const hasStale = allLeaves.some(
      (l) => l.sessionId !== null && !validIds.has(l.sessionId)
    );
    if (!hasStale) return;

    const repairedRoot = validateAndRepair(state.root, validIds);
    dispatch({
      type: "RESTORE_LAYOUT",
      state: { ...state, root: repairedRoot },
    });
  }, [sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save to localStorage on state change (debounced 300ms)
  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      savePaneLayout(state);
    }, 300);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state]);

  // Intercept RESET_LAYOUT to also clear localStorage
  const wrappedDispatch: React.Dispatch<PaneAction> = (action) => {
    if (action.type === "RESET_LAYOUT") {
      clearPaneLayout();
    }
    dispatch(action);
  };

  return [state, wrappedDispatch];
}

/** Derived selector: get the currently-focused leaf pane */
export function getFocusedLeaf(state: PaneState) {
  return findLeaf(state.root, state.focusedPaneId) ?? null;
}
