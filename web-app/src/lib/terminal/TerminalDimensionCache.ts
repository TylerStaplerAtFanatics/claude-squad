/**
 * TerminalDimensionCache - localStorage persistence for terminal dimensions.
 *
 * Caches terminal dimensions per session to enable instant reconnection
 * without waiting for size stability detection. Pure utility functions
 * with no React dependencies.
 */

export interface CachedDimensions {
  cols: number;
  rows: number;
  /**
   * Pixels per column at the time of the last fit. When present alongside
   * cellHeight, TerminalOutput can pre-calculate cols/rows from the container's
   * pixel size on mount — enabling an immediate connection before xterm fires
   * its first onResize event.
   */
  cellWidth?: number;
  /**
   * Pixels per row at the time of the last fit.
   */
  cellHeight?: number;
}

/**
 * Retrieve cached terminal dimensions for a given session.
 *
 * @param sessionId - The session identifier used as the cache key
 * @returns The cached dimensions, or null if not found or on error
 */
export function getCachedDimensions(sessionId: string): CachedDimensions | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = `terminal-dimensions-${sessionId}`;
    const cached = localStorage.getItem(key);
    if (cached) {
      const dims = JSON.parse(cached) as CachedDimensions;
      console.log(`[TerminalDimensionCache] Loaded cached dimensions for ${sessionId}: ${dims.cols}x${dims.rows} (cell: ${dims.cellWidth?.toFixed(2)}x${dims.cellHeight?.toFixed(2)})`);
      return dims;
    }
  } catch (err) {
    console.warn('[TerminalDimensionCache] Failed to load cached dimensions:', err);
  }
  return null;
}

/**
 * Save terminal dimensions to localStorage for a given session.
 *
 * @param sessionId - The session identifier used as the cache key
 * @param cols - Number of terminal columns
 * @param rows - Number of terminal rows
 * @param cellWidth - Optional pixel width per column (from xterm's render service)
 * @param cellHeight - Optional pixel height per row (from xterm's render service)
 */
export function saveDimensions(sessionId: string, cols: number, rows: number, cellWidth?: number, cellHeight?: number): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `terminal-dimensions-${sessionId}`;
    const payload: CachedDimensions = { cols, rows };
    if (cellWidth != null && cellHeight != null) {
      payload.cellWidth = cellWidth;
      payload.cellHeight = cellHeight;
    }
    localStorage.setItem(key, JSON.stringify(payload));
    console.log(`[TerminalDimensionCache] Saved dimensions for ${sessionId}: ${cols}x${rows}${cellWidth != null ? ` (cell: ${cellWidth.toFixed(2)}x${cellHeight!.toFixed(2)})` : ''}`);
  } catch (err) {
    console.warn('[TerminalDimensionCache] Failed to save dimensions:', err);
  }
}
