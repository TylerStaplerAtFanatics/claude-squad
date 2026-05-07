import { PaneId, PaneNode, LeafPane, SplitPane, PaneState, SessionDetailTab } from "./paneTypes";

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;
export const MAX_DEPTH = 8;

/** Generate a unique pane ID */
export function generatePaneId(): PaneId {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

/** Create a new empty leaf pane */
export function createLeaf(id?: PaneId, activeTab: SessionDetailTab = "terminal"): LeafPane {
  return { type: "leaf", id: id ?? generatePaneId(), sessionId: null, activeTab };
}

/** Return the initial single-pane state */
export function initialPaneState(): PaneState {
  const leaf = createLeaf();
  return {
    root: leaf,
    focusedPaneId: leaf.id,
    zoomedPaneId: null,
  };
}

/** Collect all leaf panes from the tree */
export function getAllLeaves(root: PaneNode): LeafPane[] {
  if (root.type === "leaf") return [root];
  return [...getAllLeaves(root.first), ...getAllLeaves(root.second)];
}

/** Find a leaf by id, returns null if not found */
export function findLeaf(root: PaneNode, id: PaneId): LeafPane | null {
  if (root.type === "leaf") {
    return root.id === id ? root : null;
  }
  return findLeaf(root.first, id) ?? findLeaf(root.second, id);
}

/** Find the parent SplitPane of the given node id */
export function findParentSplit(root: PaneNode, id: PaneId): SplitPane | null {
  if (root.type === "leaf") return null;
  if (root.first.id === id || root.second.id === id) return root;
  return findParentSplit(root.first, id) ?? findParentSplit(root.second, id);
}

/** Find a SplitPane by its own id */
export function findSplit(root: PaneNode, splitId: PaneId): SplitPane | null {
  if (root.type === "leaf") return null;
  if (root.id === splitId) return root;
  return findSplit(root.first, splitId) ?? findSplit(root.second, splitId);
}

/** Check if a pane id exists somewhere in the subtree */
export function containsPaneId(node: PaneNode, id: PaneId): boolean {
  if (node.type === "leaf") return node.id === id;
  return containsPaneId(node.first, id) || containsPaneId(node.second, id);
}

/** Get the current depth of nesting for a given pane id */
function getDepthOf(root: PaneNode, targetId: PaneId, depth = 0): number {
  if (root.type === "leaf") return root.id === targetId ? depth : -1;
  const d1 = getDepthOf(root.first, targetId, depth + 1);
  if (d1 >= 0) return d1;
  return getDepthOf(root.second, targetId, depth + 1);
}

/** Check whether splitting the given leaf would exceed MAX_DEPTH */
export function wouldExceedMaxDepth(root: PaneNode, paneId: PaneId): boolean {
  const depth = getDepthOf(root, paneId);
  return depth < 0 || depth >= MAX_DEPTH;
}

/**
 * Replace the node with the given targetId in the tree, returning a new tree.
 * If not found, returns the original root unchanged.
 */
export function replaceNode(root: PaneNode, targetId: PaneId, replacement: PaneNode): PaneNode {
  if (root.id === targetId) return replacement;
  if (root.type === "leaf") return root;
  const newFirst = replaceNode(root.first, targetId, replacement);
  const newSecond = replaceNode(root.second, targetId, replacement);
  if (newFirst === root.first && newSecond === root.second) return root;
  return { ...root, first: newFirst, second: newSecond };
}

/**
 * Find the nearest ancestor SplitPane whose direction aligns with the given arrow direction.
 * "ArrowLeft"/"ArrowRight" → look for "vertical" splits
 * "ArrowUp"/"ArrowDown"   → look for "horizontal" splits
 */
export function findNearestAncestorSplit(
  root: PaneNode,
  paneId: PaneId,
  arrowDirection: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"
): SplitPane | null {
  const neededDirection = (arrowDirection === "ArrowLeft" || arrowDirection === "ArrowRight")
    ? "vertical"
    : "horizontal";

  function search(node: PaneNode, ancestors: SplitPane[]): SplitPane | null {
    if (node.type === "leaf") {
      if (node.id !== paneId) return null;
      // Walk ancestors from nearest to farthest
      for (let i = ancestors.length - 1; i >= 0; i--) {
        if (ancestors[i].direction === neededDirection) return ancestors[i];
      }
      return null;
    }
    const withThis = [...ancestors, node];
    return search(node.first, withThis) ?? search(node.second, withThis);
  }

  return search(root, []);
}

/**
 * Get the adjacent leaf in a given direction from the focused pane.
 * Returns null if no adjacent pane exists in that direction.
 */
export function getAdjacentLeaf(
  root: PaneNode,
  fromId: PaneId,
  direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"
): LeafPane | null {
  // Determine the split direction we care about
  const splitDir = (direction === "ArrowLeft" || direction === "ArrowRight") ? "vertical" : "horizontal";
  const goToSecond = direction === "ArrowRight" || direction === "ArrowDown";

  function findAdjacentInNode(node: PaneNode): LeafPane | null {
    if (node.type === "leaf") return null;
    if (node.direction !== splitDir) {
      return findAdjacentInNode(node.first) ?? findAdjacentInNode(node.second);
    }

    // This split is in the right direction
    const inFirst = containsPaneId(node.first, fromId);
    const inSecond = containsPaneId(node.second, fromId);

    if (inFirst && goToSecond) {
      // Move to the first (leftmost/topmost) leaf of second subtree
      return getFirstLeaf(node.second);
    }
    if (inSecond && !goToSecond) {
      // Move to the last (rightmost/bottommost) leaf of first subtree
      return getLastLeaf(node.first);
    }
    // fromId is in one side but we're going the other direction — recurse
    if (inFirst) return findAdjacentInNode(node.first);
    if (inSecond) return findAdjacentInNode(node.second);
    return null;
  }

  return findAdjacentInNode(root);
}

function getFirstLeaf(node: PaneNode): LeafPane {
  if (node.type === "leaf") return node;
  return getFirstLeaf(node.first);
}

function getLastLeaf(node: PaneNode): LeafPane {
  if (node.type === "leaf") return node;
  return getLastLeaf(node.second);
}
