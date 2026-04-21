"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useReviewQueueContext } from "@/lib/contexts/ReviewQueueContext";
import { useApprovalsContext } from "@/lib/contexts/ApprovalsContext";
import { useReviewQueueNavigation } from "@/lib/hooks/useReviewQueueNavigation";
import { ReviewQueueBadge } from "./ReviewQueueBadge";
import { Priority, AttentionReason, ReviewItem } from "@/gen/session/v1/types_pb";
import styles from "./ReviewQueuePanel.module.css";

interface ReviewQueuePanelProps {
  onSessionClick?: (sessionId: string) => void;
  onSkipSession?: (sessionId: string) => Promise<void>;
  autoRefresh?: boolean;
  refreshInterval?: number;
  onItemsChange?: (items: ReviewItem[]) => void; // Callback to expose queue items for navigation
  onAcknowledged?: (sessionId: string) => void; // Notifies parent when a session is acknowledged (for auto-advance)
}

/**
 * ReviewQueuePanel displays all sessions that need user attention.
 *
 * Shows items sorted by priority with filtering capabilities.
 * Uses hybrid push/poll strategy for real-time updates:
 * - WebSocket push notifications for immediate session status changes
 * - 30-second fallback polling to catch any missed events
 *
 * @example
 * ```tsx
 * <ReviewQueuePanel
 *   onSessionClick={(id) => navigateToSession(id)}
 *   autoRefresh={true}
 *   refreshInterval={5000}
 * />
 * ```
 */
export function ReviewQueuePanel({
  onSessionClick,
  onSkipSession,
  autoRefresh = true,
  refreshInterval = 5000,
  onItemsChange,
  onAcknowledged,
}: ReviewQueuePanelProps) {
  const [priorityFilter, setPriorityFilter] = useState<Priority | undefined>(
    undefined
  );
  const [reasonFilter, setReasonFilter] = useState<AttentionReason | undefined>(
    undefined
  );
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  // Track whether queue ever had items so we can show "all done" vs generic empty state
  const [hadItems, setHadItems] = useState(false);

  // Live region announcement text for screen readers
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  // Prevent announcement on initial mount
  const hasMountedRef = useRef(false);

  const {
    items: allItems,
    totalItems,
    loading,
    error,
    byPriority,
    byReason,
    averageAgeSeconds,
    oldestAgeSeconds,
    refresh,
    acknowledgeSession,
  } = useReviewQueueContext();

  // ─── Snapshot-on-enter pattern ────────────────────────────────────────────
  // Captures the session IDs present when the user enters the queue.
  // New items arriving while reviewing appear in a banner rather than being
  // injected mid-list, preventing queue jumps during triage (Twitter-style).
  const [reviewingIdsSnapshot, setReviewingIdsSnapshot] = useState<Set<string> | null>(null);

  // Initialize snapshot when the queue first loads with items
  useEffect(() => {
    if (reviewingIdsSnapshot === null && allItems.length > 0) {
      setReviewingIdsSnapshot(new Set(allItems.map((item) => item.sessionId)));
    }
  }, [allItems, reviewingIdsSnapshot]);

  // Remove acknowledged/resolved items from snapshot (forward-only — no re-injection)
  useEffect(() => {
    if (reviewingIdsSnapshot === null) return;
    const liveIds = new Set(allItems.map((item) => item.sessionId));
    const pruned = new Set([...reviewingIdsSnapshot].filter((id) => liveIds.has(id)));
    if (pruned.size !== reviewingIdsSnapshot.size) {
      setReviewingIdsSnapshot(pruned);
    }
  }, [allItems, reviewingIdsSnapshot]);

  const refreshSnapshot = useCallback(() => {
    setReviewingIdsSnapshot(new Set(allItems.map((item) => item.sessionId)));
    refresh();
  }, [allItems, refresh]);
  // ─────────────────────────────────────────────────────────────────────────

  // Apply client-side filtering to all live items
  const allFilteredItems = useMemo(() => {
    let filtered = allItems;
    if (priorityFilter !== undefined) {
      filtered = filtered.filter((item) => item.priority === priorityFilter);
    }
    if (reasonFilter !== undefined) {
      filtered = filtered.filter((item) => item.reason === reasonFilter);
    }
    return filtered;
  }, [allItems, priorityFilter, reasonFilter]);

  // Items that are in the snapshot (stable ordered list for the main queue)
  const items = useMemo(() => {
    if (reviewingIdsSnapshot === null) return allFilteredItems;
    return allFilteredItems.filter((item) => reviewingIdsSnapshot.has(item.sessionId));
  }, [allFilteredItems, reviewingIdsSnapshot]);

  // New items not yet in snapshot — shown in the refresh banner
  const newItemsCount = useMemo(() => {
    if (reviewingIdsSnapshot === null) return 0;
    return allFilteredItems.filter((item) => !reviewingIdsSnapshot.has(item.sessionId)).length;
  }, [allFilteredItems, reviewingIdsSnapshot]);

  // Approval actions for APPROVAL_PENDING items
  const { approve: approveRequest, deny: denyRequest } = useApprovalsContext();

  // Keyboard navigation
  const { currentIndex, goToNext, goToPrevious } = useReviewQueueNavigation({
    items,
    onNavigate: (item, index) => {
      // Navigate to the selected session
      onSessionClick?.(item.sessionId);
    },
    enableKeyboardShortcuts: true,
  });

  // Notify parent component when queue items change (for navigation)
  useEffect(() => {
    if (onItemsChange) {
      onItemsChange(items);
    }
  }, [items, onItemsChange]);

  // Track if queue ever had items (for "all done" vs generic empty state)
  useEffect(() => {
    if (items.length > 0) {
      setHadItems(true);
    }
  }, [items.length]);

  // Update live announcement for screen readers when queue changes
  useEffect(() => {
    if (loading) return;
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return; // Skip announcement on initial mount
    }
    if (items.length === 0 && hadItems) {
      setLiveAnnouncement('Queue cleared. All items reviewed.');
    } else if (items.length > 0) {
      setLiveAnnouncement(`${items.length} ${items.length === 1 ? 'item' : 'items'} need attention.`);
    }
  }, [items.length, hadItems, loading]);

  // Format duration in seconds (e.g., averageAgeSeconds, oldestAgeSeconds)
  const formatDuration = (durationSeconds: bigint): string => {
    const duration = Number(durationSeconds);
    if (duration < 0 || duration > 31_536_000) return "Unknown"; // Cap at 1 year; guards clock skew / unit mismatch
    if (duration < 60) return `${duration}s`;
    if (duration < 3600) return `${Math.floor(duration / 60)}m`;
    if (duration < 86400) return `${Math.floor(duration / 3600)}h`;
    return `${Math.floor(duration / 86400)}d`;
  };

  // Format timestamp (seconds since epoch) as "time ago"
  const formatTimestamp = (timestampSeconds: bigint): string => {
    const timestamp = Number(timestampSeconds);
    if (timestamp === 0) return "never";

    const now = Math.floor(Date.now() / 1000);
    const age = now - timestamp;

    if (age < 0) return "in the future"; // Clock skew protection
    if (age < 60) return `${age}s`;
    if (age < 3600) return `${Math.floor(age / 60)}m`;
    if (age < 86400) return `${Math.floor(age / 3600)}h`;
    return `${Math.floor(age / 86400)}d`;
  };

  const getPriorityLabel = (priority: Priority): string => {
    switch (priority) {
      case Priority.URGENT:
        return "Urgent";
      case Priority.HIGH:
        return "High";
      case Priority.MEDIUM:
        return "Medium";
      case Priority.LOW:
        return "Low";
      default:
        return "All";
    }
  };

  const getReasonLabel = (reason: AttentionReason): string => {
    switch (reason) {
      case AttentionReason.APPROVAL_PENDING:
        return "Approval";
      case AttentionReason.INPUT_REQUIRED:
        return "Input";
      case AttentionReason.ERROR_STATE:
        return "Error";
      case AttentionReason.IDLE_TIMEOUT:
      case AttentionReason.IDLE:
        return "Idle";
      case AttentionReason.TASK_COMPLETE:
        return "Complete";
      case AttentionReason.STALE:
        return "Stale";
      default:
        return "All";
    }
  };

  const handleFilterByPriority = (priority: Priority | undefined) => {
    setPriorityFilter(priority);
    setReasonFilter(undefined); // Clear reason filter when changing priority
  };

  const handleFilterByReason = (reason: AttentionReason | undefined) => {
    setReasonFilter(reason);
    setPriorityFilter(undefined); // Clear priority filter when changing reason
  };

  const summaryCount = useMemo(() => {
    const parts: string[] = [];
    const reasonEntries: [AttentionReason, string][] = [
      [AttentionReason.APPROVAL_PENDING, "approval"],
      [AttentionReason.INPUT_REQUIRED, "input needed"],
      [AttentionReason.ERROR_STATE, "error"],
      [AttentionReason.IDLE_TIMEOUT, "timed out"],
      [AttentionReason.IDLE, "idle"],
      [AttentionReason.STALE, "stale"],
      [AttentionReason.TASK_COMPLETE, "complete"],
    ];
    for (const [reason, label] of reasonEntries) {
      const count = byReason.get(reason) ?? 0;
      if (count > 0) parts.push(`${count} ${label}${count !== 1 ? "s" : ""}`);
    }
    return parts.join(", ");
  }, [byReason]);

  const activeFilterLabel = useMemo(() => {
    if (priorityFilter !== undefined) return `Filter: ${getPriorityLabel(priorityFilter)}`;
    if (reasonFilter !== undefined) return `Filter: ${getReasonLabel(reasonFilter)}`;
    return "Filter";
  }, [priorityFilter, reasonFilter]);

  const hasActiveFilter = priorityFilter !== undefined || reasonFilter !== undefined;

  if (error) {
    return (
      <div className={styles.error}>
        <p>Failed to load review queue: {error.message}</p>
        <button onClick={refresh} className={styles.retryButton}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel} data-testid="review-queue">
      {/* Screen reader live region for queue count changes */}
      <div aria-live="polite" aria-atomic="true" className={styles.visuallyHidden}>
        {liveAnnouncement}
      </div>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>
            Review Queue{" "}
            {totalItems > 0 && (
              <span className={styles.count} data-testid="review-queue-badge">
                ({totalItems})
              </span>
            )}
          </h2>
          <button
            onClick={refreshSnapshot}
            className={styles.refreshButton}
            disabled={loading}
            aria-label="Refresh review queue"
          >
            {loading ? "⟳" : "↻"}
          </button>
        </div>

        {totalItems > 0 && (
          <div className={styles.stats} data-testid="queue-statistics">
            <span className={styles.stat} data-testid="total-items">
              {summaryCount || `${totalItems} ${totalItems === 1 ? "item" : "items"}`}
            </span>
          </div>
        )}

        {/* Heads-up callout when oldest item is over 5 minutes old */}
        {oldestAgeSeconds > BigInt(300) && (
          <div className={styles.oldestCallout} role="status">
            Oldest item: {formatDuration(oldestAgeSeconds)}
          </div>
        )}

        {/* New-items banner: shows when items arrive after snapshot was taken */}
        {newItemsCount > 0 && (
          <button
            className={styles.newItemsBanner}
            onClick={refreshSnapshot}
            aria-label={`${newItemsCount} new item${newItemsCount !== 1 ? "s" : ""} added. Click to refresh the list.`}
          >
            {newItemsCount} new item{newItemsCount !== 1 ? "s" : ""} added — click to refresh
          </button>
        )}
      </div>

      {totalItems > 0 && (
        <div className={styles.filterToggleRow}>
          <button
            className={`${styles.filterToggle} ${hasActiveFilter ? styles.filterToggleActive : ""}`}
            onClick={() => setIsFiltersOpen((o) => !o)}
            aria-expanded={isFiltersOpen}
            aria-controls="review-queue-filters"
          >
            {activeFilterLabel} {isFiltersOpen ? "▲" : "▼"}
          </button>
          {hasActiveFilter && (
            <button
              className={styles.filterClear}
              onClick={() => { setPriorityFilter(undefined); setReasonFilter(undefined); }}
              aria-label="Clear active filter"
            >
              ✕ Clear
            </button>
          )}
        </div>
      )}

      {isFiltersOpen && (
        <div id="review-queue-filters" className={styles.filters}>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Priority:</label>
            <div className={styles.filterButtons}>
              <button
                className={`${styles.filterButton} ${priorityFilter === undefined ? styles.active : ""}`}
                onClick={() => handleFilterByPriority(undefined)}
                aria-pressed={priorityFilter === undefined}
              >
                All ({totalItems})
              </button>
              {[Priority.URGENT, Priority.HIGH, Priority.MEDIUM, Priority.LOW].map(
                (priority) => {
                  const count = byPriority.get(priority) ?? 0;
                  return (
                    <button
                      key={priority}
                      className={`${styles.filterButton} ${priorityFilter === priority ? styles.active : ""}`}
                      onClick={() => handleFilterByPriority(priority)}
                      disabled={count === 0}
                      aria-pressed={priorityFilter === priority}
                    >
                      {getPriorityLabel(priority)} ({count})
                    </button>
                  );
                }
              )}
            </div>
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>Reason:</label>
            <div className={styles.filterButtons}>
              <button
                className={`${styles.filterButton} ${reasonFilter === undefined ? styles.active : ""}`}
                onClick={() => handleFilterByReason(undefined)}
                aria-pressed={reasonFilter === undefined}
              >
                All ({totalItems})
              </button>
              {[
                AttentionReason.APPROVAL_PENDING,
                AttentionReason.INPUT_REQUIRED,
                AttentionReason.ERROR_STATE,
                AttentionReason.IDLE_TIMEOUT,
                AttentionReason.IDLE,
                AttentionReason.STALE,
                AttentionReason.TASK_COMPLETE,
              ].map((reason) => {
                const count = byReason.get(reason) ?? 0;
                return (
                  <button
                    key={reason}
                    className={`${styles.filterButton} ${reasonFilter === reason ? styles.active : ""}`}
                    onClick={() => handleFilterByReason(reason)}
                    disabled={count === 0}
                    aria-pressed={reasonFilter === reason}
                  >
                    {getReasonLabel(reason)} ({count})
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className={styles.items}>
        {loading && items.length === 0 ? (
          <div className={styles.loading}>Loading review queue...</div>
        ) : items.length === 0 ? (
          hadItems ? (
            <div className={`${styles.empty} ${styles.completionState}`}>
              <p className={styles.completionIcon}>[✓]</p>
              <p>All done! 0 items remaining.</p>
              <p className={styles.emptySubtext}>
                Queue cleared.
              </p>
            </div>
          ) : (
            <div className={styles.empty}>
              <p>No sessions need attention!</p>
              <p className={styles.emptySubtext}>
                All sessions are running smoothly.
              </p>
            </div>
          )
        ) : (
          <>
            {items.map((item, index) => (
              <div
                key={item.sessionId}
                className={styles.item}
                data-testid={index === currentIndex ? "current-item" : "review-item"}
                data-session-id={item.sessionId}
              >
                <div
                  className={`${styles.itemClickable} ${index === currentIndex ? styles.currentItem : ""}`}
                  onClick={() => onSessionClick?.(item.sessionId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSessionClick?.(item.sessionId);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  data-testid={`review-item-${item.sessionId}`}
                  data-current={index === currentIndex ? "true" : undefined}
                >
                  <div className={styles.itemHeader}>
                    <h3 className={styles.itemTitle}>{item.sessionName}</h3>
                    <ReviewQueueBadge
                      priority={item.priority}
                      reason={item.reason}
                      compact={true}
                    />
                  </div>
                  <div className={styles.itemBody}>
                    <ReviewQueueBadge
                      priority={item.priority}
                      reason={item.reason}
                      compact={false}
                    />
                    {item.context && !item.metadata?.["pending_approval_id"] && (
                      <p className={styles.itemContext}>{item.context}</p>
                    )}
                    {item.patternName && (
                      <span className={styles.itemPattern}>
                        Pattern: {item.patternName}
                      </span>
                    )}
                    {item.metadata?.["pending_approval_id"] && (
                      <>
                        {(item.metadata["tool_input_command"] || item.metadata["tool_input_file"]) && (
                          <pre className={styles.commandPreview}>
                            {item.metadata["tool_input_command"] || item.metadata["tool_input_file"]}
                          </pre>
                        )}
                        {item.metadata["cwd"] && (
                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>Directory:</span>
                            <span className={styles.detailValue}>{item.metadata["cwd"]}</span>
                          </div>
                        )}
                        {item.metadata["orphaned"] === "true" && (
                          <span className={styles.expiredBadge}>Expired</span>
                        )}
                      </>
                    )}
                    {/* Session details */}
                    <div className={styles.sessionDetails}>
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Program:</span>
                        <span className={styles.detailValue}>{item.program}</span>
                      </div>
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Branch:</span>
                        <span className={styles.detailValue}>{item.branch}</span>
                      </div>
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Path:</span>
                        <span className={styles.detailValue} title={item.path}>{item.path}</span>
                      </div>
                      {item.tags && item.tags.length > 0 && (
                        <div className={styles.detailRow}>
                          <span className={styles.detailLabel}>Tags:</span>
                          <div className={styles.tags}>
                            {item.tags.map((tag, idx) => (
                              <span key={idx} className={styles.tag}>{tag}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={styles.itemFooter}>
                    <span className={styles.itemAge}>
                      Last Activity: {formatTimestamp(item.lastActivity?.seconds ?? BigInt(0))}{" "}
                      ago
                    </span>
                    {item.diffStats && (item.diffStats.added > 0 || item.diffStats.removed > 0) && (
                      <span className={styles.diffStats}>
                        <span className={styles.diffAdded}>+{item.diffStats.added}</span>
                        <span className={styles.diffRemoved}>-{item.diffStats.removed}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.itemActions}>
                  {item.metadata?.["pending_approval_id"] && (
                    <>
                      <button
                        className={styles.approveButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          approveRequest(item.metadata!["pending_approval_id"]).finally(() => {
                            acknowledgeSession(item.sessionId);
                            onAcknowledged?.(item.sessionId);
                          });
                        }}
                        title="Approve this tool-use request"
                        aria-label="Approve"
                        data-testid={`approve-${item.sessionId}`}
                      >
                        ✓
                      </button>
                      <button
                        className={styles.denyButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          denyRequest(item.metadata!["pending_approval_id"]).finally(() => {
                            acknowledgeSession(item.sessionId);
                            onAcknowledged?.(item.sessionId);
                          });
                        }}
                        title="Deny this tool-use request"
                        aria-label="Deny"
                        data-testid={`deny-${item.sessionId}`}
                      >
                        ✗
                      </button>
                    </>
                  )}
                  {/* Skip button: only shown for non-approval items.
                      Approval items already have explicit ✓ Approve / ✗ Deny buttons above. */}
                  {!item.metadata?.["pending_approval_id"] && (
                    <button
                      className={styles.skipButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onSkipSession) {
                          onSkipSession(item.sessionId);
                        } else {
                          acknowledgeSession(item.sessionId);
                        }
                        onAcknowledged?.(item.sessionId);
                      }}
                      title="Acknowledge session (remove from queue)"
                      aria-label="Acknowledge session"
                      data-testid={`acknowledge-${item.sessionId}`}
                    >
                      ⏭
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!loading && <div data-testid="review-queue-loaded" aria-hidden="true" />}
          </>
        )}
      </div>
    </div>
  );
}
