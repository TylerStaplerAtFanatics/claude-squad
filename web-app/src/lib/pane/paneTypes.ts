export type PaneId = string;
export type SplitDirection = "horizontal" | "vertical";

// Mirrors SessionDetail's tab union
export type SessionDetailTab = "terminal" | "diff" | "vcs" | "logs" | "info" | "files";

export interface LeafPane {
  type: "leaf";
  id: PaneId;
  sessionId: string | null;  // null = empty slot ("click a session to load")
  activeTab: SessionDetailTab;
}

export interface SplitPane {
  type: "split";
  id: PaneId;
  // "vertical"   = children sit left | right (column split)
  // "horizontal" = children sit top | bottom (row split)
  direction: SplitDirection;
  ratio: number;  // [0.0, 1.0], fraction of space given to `first`
  first: PaneNode;
  second: PaneNode;
}

export type PaneNode = LeafPane | SplitPane;

export interface PaneState {
  root: PaneNode;
  focusedPaneId: PaneId;
  zoomedPaneId: PaneId | null;  // Ctrl+Z zoom: null = normal view
}

// Persisted to localStorage as-is (no DOM refs, no functions)
export interface PersistedPaneLayout {
  version: 1;
  root: PaneNode;
  focusedPaneId: PaneId;
  zoomedPaneId: PaneId | null;
}

export type PaneAction =
  | { type: "SPLIT_PANE";    paneId: PaneId; direction: SplitDirection }
  | { type: "CLOSE_PANE";    paneId: PaneId }
  | { type: "RESIZE_PANE";   splitId: PaneId; ratio: number }
  | { type: "FOCUS_PANE";    paneId: PaneId }
  | { type: "ASSIGN_SESSION"; paneId: PaneId; sessionId: string }
  | { type: "ASSIGN_TAB";    paneId: PaneId; tab: SessionDetailTab }
  | { type: "ZOOM_PANE";     paneId: PaneId | null }
  | { type: "NUDGE_RESIZE";  paneId: PaneId; direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"; amountPx: number; containerSizePx: number }
  | { type: "RESET_LAYOUT" }
  | { type: "RESTORE_LAYOUT"; state: PaneState };
