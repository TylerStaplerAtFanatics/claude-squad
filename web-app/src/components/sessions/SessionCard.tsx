"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Session, SessionStatus, ReviewItem, InstanceType, RateLimitState, CheckpointProto } from "@/gen/session/v1/types_pb";
import { ReviewQueueBadge } from "./ReviewQueueBadge";
import { StatusBadge } from "./StatusBadge";
import { GitHubBadge } from "./GitHubBadge";
import { TagEditor } from "./TagEditor";
import { useTerminalSnapshot } from "@/lib/hooks/useTerminalSnapshot";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";
import * as snapshotStyles from "./SessionCard.css";
import { CheckpointButton } from "./CheckpointButton";
import { CheckpointList } from "./CheckpointList";
import styles from "./SessionCard.module.css";

interface SessionCardProps {
  session: Session;
  onClick?: () => void;
  onDelete?: () => Promise<void> | void;
  onPause?: () => void;
  onResume?: () => void;
  onDuplicate?: () => void;
  onNewWorkspace?: () => void;
  onRename?: (sessionId: string, newTitle: string) => Promise<boolean>;
  onRestart?: (sessionId: string) => Promise<boolean>;
  onUpdateTags?: (sessionId: string, tags: string[]) => void;
  onCreateCheckpoint?: (sessionId: string, label: string) => Promise<boolean>;
  onListCheckpoints?: (sessionId: string) => Promise<CheckpointProto[]>;
  onForkFromCheckpoint?: (sessionId: string, checkpointId: string, newTitle: string) => Promise<Session | null>;
  onRunOneShot?: (sessionId: string) => Promise<void>;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  reviewItem?: ReviewItem; // Optional review queue item if session needs attention
  detectedStatus?: string; // Terminal-detected status from pattern analysis
  detectedContext?: string; // Context string for the detected status
}

export function SessionCard({
  session,
  onClick,
  onDelete,
  onPause,
  onResume,
  onDuplicate,
  onNewWorkspace,
  onRename,
  onRestart,
  onUpdateTags,
  onCreateCheckpoint,
  onListCheckpoints,
  onForkFromCheckpoint,
  onRunOneShot,
  selectMode = false,
  isSelected = false,
  onToggleSelect,
  reviewItem,
  detectedStatus,
  detectedContext,
}: SessionCardProps) {
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [newTitle, setNewTitle] = useState(session.title);
  const [isRestartConfirmOpen, setIsRestartConfirmOpen] = useState(false);
  const [isForkOpen, setIsForkOpen] = useState(false);
  const [forkCheckpoints, setForkCheckpoints] = useState<CheckpointProto[]>([]);
  const [forkTitle, setForkTitle] = useState("");
  const [activeForkCheckpointId, setActiveForkCheckpointId] = useState("");
  const [isForking, setIsForking] = useState(false);
  const [isRunningOneShot, setIsRunningOneShot] = useState(false);
  const [oneShotResult, setOneShotResult] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [forkError, setForkError] = useState("");
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false);

  // Refs for focus trap: dialog containers and the buttons that trigger them
  const renameDialogRef = useRef<HTMLDivElement>(null);
  const restartDialogRef = useRef<HTMLDivElement>(null);
  const forkDialogRef = useRef<HTMLDivElement>(null);
  const renameTriggerRef = useRef<HTMLButtonElement>(null);
  const restartTriggerRef = useRef<HTMLButtonElement>(null);
  const forkTriggerRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(renameDialogRef, isRenameOpen, renameTriggerRef);
  useFocusTrap(restartDialogRef, isRestartConfirmOpen, restartTriggerRef);
  useFocusTrap(forkDialogRef, isForkOpen, forkTriggerRef);

  // Only fetch snapshot for running sessions (paused/loading sessions have stale output)
  const isSnapshotEnabled = session.status === SessionStatus.RUNNING && isSnapshotOpen;
  const { html: snapshotHtml, isEmpty: snapshotIsEmpty, loading: snapshotLoading, error: snapshotError } =
    useTerminalSnapshot(session.id, isSnapshotEnabled);

  const [loadedCheckpoints, setLoadedCheckpoints] = useState<CheckpointProto[]>([]);

  // Load checkpoints on mount and refresh when a new checkpoint is created
  const refreshCheckpoints = useCallback(async () => {
    if (!onListCheckpoints) return;
    const cps = await onListCheckpoints(session.id);
    setLoadedCheckpoints(cps);
  }, [onListCheckpoints, session.id]);

  useEffect(() => {
    refreshCheckpoints();
  }, [refreshCheckpoints]);

  const getStatusColor = (status: SessionStatus): string => {
    switch (status) {
      case SessionStatus.RUNNING:
        return styles.statusRunning;
      case SessionStatus.READY:
        return styles.statusReady;
      case SessionStatus.PAUSED:
        return styles.statusPaused;
      case SessionStatus.LOADING:
        return styles.statusLoading;
      case SessionStatus.NEEDS_APPROVAL:
        return styles.statusNeedsApproval;
      default:
        return styles.statusUnknown;
    }
  };

  const getStatusText = (status: SessionStatus): string => {
    switch (status) {
      case SessionStatus.RUNNING:
        return "Running";
      case SessionStatus.READY:
        return "Ready";
      case SessionStatus.PAUSED:
        return "Paused";
      case SessionStatus.LOADING:
        return "Loading";
      case SessionStatus.NEEDS_APPROVAL:
        return "Needs Approval";
      default:
        return "Unknown";
    }
  };

  const getRateLimitStateText = (state: RateLimitState): string => {
    switch (state) {
      case RateLimitState.NONE:
        return "";
      case RateLimitState.WAITING:
        return "Rate Limited";
      case RateLimitState.RECOVERING:
        return "Recovering...";
      case RateLimitState.RECOVERED:
        return "Recovered";
      case RateLimitState.FAILED:
        return "Recovery Failed";
      default:
        return "";
    }
  };

  const getRateLimitStateColor = (state: RateLimitState): string => {
    switch (state) {
      case RateLimitState.NONE:
        return "";
      case RateLimitState.WAITING:
        return styles.statusNeedsApproval;
      case RateLimitState.RECOVERING:
        return styles.statusLoading;
      case RateLimitState.RECOVERED:
        return styles.statusReady;
      case RateLimitState.FAILED:
        return styles.statusPaused;
      default:
        return "";
    }
  };

  const formatDate = (timestamp?: { seconds: bigint; nanos: number }): string => {
    if (!timestamp) return "N/A";
    const date = new Date(Number(timestamp.seconds) * 1000);
    return date.toLocaleString();
  };

  const formatTimeAgo = (timestamp?: { seconds: bigint; nanos: number }): string => {
    if (!timestamp || timestamp.seconds === BigInt(0)) return "Never";
    const now = Date.now();
    const date = new Date(Number(timestamp.seconds) * 1000);
    const seconds = Math.floor((now - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const isPaused = session.status === SessionStatus.PAUSED;
  const isRunning = session.status === SessionStatus.RUNNING;
  const isReady = session.status === SessionStatus.READY;
  const isExternal = session.instanceType === InstanceType.EXTERNAL;

  // Desktop overflow menu state
  const [showOverflow, setShowOverflow] = useState(false);
  const overflowContainerRef = useRef<HTMLDivElement>(null);

  // Close overflow menu when clicking outside
  useEffect(() => {
    if (!showOverflow) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (overflowContainerRef.current && !overflowContainerRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showOverflow]);
  const sourceTerminal = session.externalMetadata?.sourceTerminal || "External";
  const muxEnabled = session.externalMetadata?.muxEnabled || false;

  const handleCardClick = (e: React.MouseEvent) => {
    if (selectMode && onToggleSelect) {
      e.stopPropagation();
      onToggleSelect();
    } else if (onClick) {
      onClick();
    }
  };

  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    // Support keyboard navigation with Enter or Space
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (selectMode && onToggleSelect) {
        onToggleSelect();
      } else if (onClick) {
        onClick();
      }
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleSelect) {
      onToggleSelect();
    }
  };

  const handleEditTags = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsTagEditorOpen(true);
  };

  const handleSaveTags = (newTags: string[]) => {
    if (onUpdateTags) {
      onUpdateTags(session.id, newTags);
    }
    setIsTagEditorOpen(false);
  };

  const handleCancelTagEdit = () => {
    setIsTagEditorOpen(false);
  };

  const handleRenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNewTitle(session.title);
    setRenameError("");
    setIsRenameOpen(true);
  };

  const handleRenameSubmit = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // Validation
    if (!newTitle.trim()) {
      setRenameError("Title cannot be empty");
      return;
    }

    if (newTitle === session.title) {
      setIsRenameOpen(false);
      return;
    }

    setIsRenaming(true);
    setRenameError("");

    try {
      const success = await onRename?.(session.id, newTitle.trim());
      if (success) {
        setIsRenameOpen(false);
      } else {
        setRenameError("Failed to rename session");
      }
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Failed to rename session");
    } finally {
      setIsRenaming(false);
    }
  };

  const handleRenameCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRenameOpen(false);
    setNewTitle(session.title);
    setRenameError("");
  };

  const handleRestartClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRestartConfirmOpen(true);
  };

  const handleRestartConfirm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRestarting(true);

    try {
      await onRestart?.(session.id);
      setIsRestartConfirmOpen(false);
    } catch (error) {
      console.error("Failed to restart session:", error);
    } finally {
      setIsRestarting(false);
    }
  };

  const handleRestartCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRestartConfirmOpen(false);
  };

  const handleForkClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const cps = await onListCheckpoints?.(session.id) ?? [];
    setForkCheckpoints(cps);
    setForkTitle(`${session.title}-fork`);
    setActiveForkCheckpointId(cps.length > 0 ? cps[cps.length - 1].id : "");
    setIsForkOpen(true);
  };

  const handleForkSubmit = async (checkpointId: string) => {
    if (!forkTitle.trim() || !checkpointId) return;
    setIsForking(true);
    setForkError("");
    try {
      const result = await onForkFromCheckpoint?.(session.id, checkpointId, forkTitle.trim());
      if (result) {
        setIsForkOpen(false);
      } else {
        setForkError("Failed to fork session");
      }
    } catch (error) {
      setForkError(error instanceof Error ? error.message : "Failed to fork session");
    } finally {
      setIsForking(false);
    }
  };

  const handleForkCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsForkOpen(false);
    setForkError("");
  };

  const handleRunOneShot = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRunOneShot) return;
    setIsRunningOneShot(true);
    setOneShotResult(null);
    try {
      await onRunOneShot(session.id);
      setOneShotResult("done");
    } catch {
      setOneShotResult("error");
    } finally {
      setIsRunningOneShot(false);
    }
  };

  return (
    <>
      {isTagEditorOpen && (
        <TagEditor
          tags={session.tags || []}
          onSave={handleSaveTags}
          onCancel={handleCancelTagEdit}
          sessionTitle={session.title}
        />
      )}
      {isRenameOpen && createPortal(
        <div className={styles.renameDialog} onClick={handleRenameCancel as unknown as React.MouseEventHandler}>
          <div
            ref={renameDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="renameDialogTitle"
            className={styles.dialogContent}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="renameDialogTitle">Rename Session</h3>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSubmit(e as any);
                if (e.key === "Escape") handleRenameCancel(e as any);
              }}
              placeholder="Enter new title"
              autoFocus
              className={styles.renameInput}
            />
            {renameError && <span className={styles.errorMessage}>{renameError}</span>}
            <div className={styles.dialogActions}>
              <button
                onClick={handleRenameSubmit}
                disabled={isRenaming || !newTitle.trim()}
                className={styles.submitButton}
              >
                {isRenaming ? "Renaming..." : "Rename"}
              </button>
              <button
                onClick={handleRenameCancel}
                disabled={isRenaming}
                className={styles.cancelButton}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {isRestartConfirmOpen && createPortal(
        <div className={styles.confirmDialog} onClick={handleRestartCancel as unknown as React.MouseEventHandler}>
          <div
            ref={restartDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="restartDialogTitle"
            className={styles.dialogContent}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Escape") handleRestartCancel(e as unknown as React.MouseEvent); }}
          >
            <h3 id="restartDialogTitle">Restart Session</h3>
            <p>Are you sure you want to restart &quot;{session.title}&quot;?</p>
            <p className={styles.warningText}>This will terminate the current process and start a new one.</p>
            <div className={styles.dialogActions}>
              <button
                onClick={handleRestartConfirm}
                disabled={isRestarting}
                className={styles.dangerButton}
              >
                {isRestarting ? "Restarting..." : "Restart"}
              </button>
              <button
                onClick={handleRestartCancel}
                disabled={isRestarting}
                className={styles.cancelButton}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {isForkOpen && createPortal(
        <div className={styles.renameDialog} onClick={handleForkCancel as unknown as React.MouseEventHandler}>
          <div
            ref={forkDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="forkDialogTitle"
            className={styles.dialogContent}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="forkDialogTitle">Fork Session</h3>
            <p>Fork &quot;{session.title}&quot; from a checkpoint into a new independent session.</p>
            <label className={styles.renameLabel}>New session title:</label>
            <input
              type="text"
              value={forkTitle}
              onChange={(e) => setForkTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") handleForkCancel(e as unknown as React.MouseEvent);
              }}
              placeholder="e.g. my-session-fork"
              className={styles.renameInput}
              autoFocus
            />
            {forkCheckpoints.length === 0 ? (
              <p className={styles.forkEmptyMessage}>
                No checkpoints found. Create a checkpoint first.
              </p>
            ) : (
              <ul className={styles.forkCheckpointList}>
                {forkCheckpoints.map((cp) => (
                  <li key={cp.id} className={styles.forkCheckpointItem}>
                    <input
                      type="radio"
                      name="forkCheckpoint"
                      value={cp.id}
                      checked={activeForkCheckpointId === cp.id}
                      onChange={() => setActiveForkCheckpointId(cp.id)}
                      id={`cp-${cp.id}`}
                    />
                    <label htmlFor={`cp-${cp.id}`} className={styles.forkCheckpointLabel}>
                      <strong>{cp.label}</strong>
                      {cp.gitCommitSha && <span className={styles.forkGitSha}>{cp.gitCommitSha.slice(0, 7)}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {forkError && <span className={styles.errorMessage}>{forkError}</span>}
            <div className={styles.dialogActions}>
              {forkCheckpoints.length > 0 && (
                <button
                  className={styles.submitButton}
                  onClick={() => handleForkSubmit(activeForkCheckpointId)}
                  disabled={isForking || !forkTitle.trim() || !activeForkCheckpointId}
                >
                  {isForking ? "Forking..." : "Fork from checkpoint"}
                </button>
              )}
              <button
                onClick={handleForkCancel}
                className={styles.cancelButton}
                disabled={isForking}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    <div
      className={`${styles.card} ${selectMode ? styles.selectMode : ""} ${isSelected ? styles.selected : ""} ${isExternal ? styles.external : ""} ${isDeleting ? styles.deleting : ""}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Session ${session.title}, status: ${getStatusText(session.status)}, program: ${session.program}`}
      aria-pressed={selectMode ? isSelected : undefined}
    >
      {selectMode && (
        <div className={styles.checkbox} onClick={handleCheckboxClick}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {}} // Controlled by onClick
            aria-label={`Select ${session.title}`}
          />
        </div>
      )}
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>{session.title}</h3>
          <div className={styles.badges}>
            {isExternal && (
              <span
                className={styles.externalBadge}
                title={`External session from ${sourceTerminal}${muxEnabled ? " (mux-enabled)" : ""}`}
                aria-label={`External session from ${sourceTerminal}`}
              >
                🔗 {sourceTerminal}
                {muxEnabled && <span className={styles.muxIndicator}>✓</span>}
              </span>
            )}
            <GitHubBadge
              prNumber={session.githubPrNumber}
              prUrl={session.githubPrUrl}
              owner={session.githubOwner}
              repo={session.githubRepo}
              sourceRef={session.githubSourceRef}
              prPriority={session.githubPrPriority}
              prState={session.githubPrState}
              isDraft={session.githubPrIsDraft}
              approvedCount={session.githubApprovedCount}
              changesRequestedCount={session.githubChangesReqCount}
              checkConclusion={session.githubCheckConclusion}
              compact={true}
            />
            {reviewItem && (
              <ReviewQueueBadge
                priority={reviewItem.priority}
                reason={reviewItem.reason}
                compact={true}
              />
            )}
            <span
              className={`${styles.status} ${getStatusColor(session.status)}`}
              role="status"
              aria-label={`Session status: ${getStatusText(session.status)}`}
            >
              {getStatusText(session.status)}
            </span>
            {session.rateLimitState && session.rateLimitState !== RateLimitState.NONE && (
              <span
                className={`${styles.status} ${getRateLimitStateColor(session.rateLimitState)}`}
                role="status"
                aria-label={`Rate limit: ${getRateLimitStateText(session.rateLimitState)}`}
              >
                {getRateLimitStateText(session.rateLimitState)}
              </span>
            )}
            {detectedStatus && (
              <StatusBadge detectedStatus={detectedStatus} context={detectedContext} />
            )}
          </div>
        </div>
        {session.tags && session.tags.length > 0 && (
          <div className={styles.tagsContainer}>
            <div className={styles.tags}>
              {session.tags.map((tag, index) => (
                <span key={index} className={styles.tag}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
        {reviewItem && !selectMode && (
          <div className={styles.reviewInfo}>
            <ReviewQueueBadge
              priority={reviewItem.priority}
              reason={reviewItem.reason}
              compact={false}
            />
            {reviewItem.context && (
              <span className={styles.reviewContext}>{reviewItem.context}</span>
            )}
          </div>
        )}
        {/* Last Activity — Tier 1 always-visible in header */}
        {(() => {
          const moSecs = session.lastMeaningfulOutput?.seconds ?? BigInt(0);
          const tuSecs = session.lastTerminalUpdate?.seconds ?? BigInt(0);
          const lastActivity = moSecs === BigInt(0) && tuSecs === BigInt(0)
            ? undefined
            : moSecs >= tuSecs ? session.lastMeaningfulOutput : session.lastTerminalUpdate;
          return lastActivity ? (
            <div className={styles.lastActivityRow}>
              <span className={styles.lastActivityLabel}>Active</span>
              <time
                dateTime={new Date(Number(lastActivity.seconds) * 1000).toISOString()}
                title={new Date(Number(lastActivity.seconds) * 1000).toISOString()}
                className={styles.lastActivityTime}
              >
                {formatTimeAgo(lastActivity)}
              </time>
            </div>
          ) : null;
        })()}
      </div>

      <div className={styles.body}>
        {/* Tier 2: branch context — one line */}
        {session.branch && (
          <div className={styles.info}>
            <div className={styles.infoRow}>
              <span className={styles.label}>Branch:</span>
              <span className={styles.value}>{session.branch}</span>
            </div>
          </div>
        )}

        {session.diffStats && (
          <div className={styles.diffStats}>
            <span className={styles.diffAdded}>+{session.diffStats.added}</span>
            <span className={styles.diffRemoved}>-{session.diffStats.removed}</span>
          </div>
        )}

        {/* Terminal snapshot preview — only for running sessions */}
        {session.status === SessionStatus.RUNNING && (
          <div className={snapshotStyles.snapshotSection} onClick={(e) => e.stopPropagation()}>
            <button
              className={snapshotStyles.snapshotToggle}
              onClick={() => setIsSnapshotOpen((prev) => !prev)}
              aria-expanded={isSnapshotOpen}
              aria-label="Toggle terminal preview"
            >
              <span>Terminal Preview</span>
              <span className={snapshotStyles.snapshotToggleIcon} aria-hidden="true">
                {isSnapshotOpen ? "▲" : "▼"}
              </span>
            </button>
            {isSnapshotOpen && (
              snapshotLoading ? (
                <div className={snapshotStyles.snapshotLoading}>Loading…</div>
              ) : snapshotError ? (
                <div className={snapshotStyles.snapshotError.base}>
                  Failed to load preview
                </div>
              ) : snapshotIsEmpty ? (
                <div className={snapshotStyles.snapshotEmpty}>No recent output</div>
              ) : (
                <div
                  className={snapshotStyles.snapshotPane}
                  // Safe: content is rendered by ansi-to-html with escapeXML enabled,
                  // or escaped manually in the plain-text fallback path.
                  dangerouslySetInnerHTML={{ __html: snapshotHtml }}
                  aria-label="Terminal output preview"
                />
              )
            )}
          </div>
        )}
      </div>

      {onListCheckpoints && (
        <div onClick={(e) => e.stopPropagation()}>
          <CheckpointList
            sessionId={session.id}
            checkpoints={loadedCheckpoints}
          />
        </div>
      )}

      <div className={styles.footer}>
          {/* Desktop: primary action + overflow menu */}
          <div className={styles.desktopActions}>
            {(isPaused || isReady) && (
              <button
                className={styles.actionButton}
                onClick={(e) => { e.stopPropagation(); onResume?.(); }}
                aria-label={`Resume session ${session.title}`}
                title="Resume this session"
              >
                <span aria-hidden="true">▶️</span> Resume
              </button>
            )}
            {isRunning && (
              <button
                className={styles.actionButton}
                onClick={(e) => { e.stopPropagation(); onPause?.(); }}
                aria-label={`Pause session ${session.title}`}
                title="Pause this session"
              >
                <span aria-hidden="true">⏸️</span> Pause
              </button>
            )}
            <div ref={overflowContainerRef} className={styles.overflowContainer}>
              <button
                className={styles.overflowButton}
                onClick={(e) => { e.stopPropagation(); setShowOverflow((o) => !o); }}
                aria-label="More session actions"
                aria-expanded={showOverflow}
                aria-haspopup="menu"
              >
                ···
              </button>
              {showOverflow && (
                <div
                  className={styles.overflowMenu}
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === "Escape") setShowOverflow(false); }}
                >
                  {!(isPaused || isReady) && (
                    <button
                      ref={null}
                      role="menuitem"
                      className={styles.overflowMenuItem}
                      onClick={(e) => { e.stopPropagation(); setShowOverflow(false); onResume?.(); }}
                      aria-label={`Resume session ${session.title}`}
                    >
                      <span aria-hidden="true">▶️</span> Resume
                    </button>
                  )}
                  {!isRunning && (
                    <button
                      role="menuitem"
                      className={styles.overflowMenuItem}
                      onClick={(e) => { e.stopPropagation(); setShowOverflow(false); onPause?.(); }}
                      aria-label={`Pause session ${session.title}`}
                    >
                      <span aria-hidden="true">⏸️</span> Pause
                    </button>
                  )}
                  <button
                    ref={renameTriggerRef}
                    role="menuitem"
                    className={styles.overflowMenuItem}
                    onClick={(e) => { e.stopPropagation(); setShowOverflow(false); handleRenameClick(e); }}
                    aria-label={`Rename session ${session.title}`}
                  >
                    <span aria-hidden="true">✏️</span> Rename
                  </button>
                  <button
                    ref={restartTriggerRef}
                    role="menuitem"
                    className={`${styles.overflowMenuItem} ${styles.overflowMenuItemDanger}`}
                    onClick={(e) => { e.stopPropagation(); setShowOverflow(false); handleRestartClick(e); }}
                    aria-label={`Restart session ${session.title}`}
                  >
                    <span aria-hidden="true">🔄</span> Restart
                  </button>
                  {onCreateCheckpoint && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <CheckpointButton
                        sessionId={session.id}
                        isRunning={session.status === SessionStatus.RUNNING}
                        onCreateCheckpoint={onCreateCheckpoint}
                        onCheckpointCreated={() => { setShowOverflow(false); refreshCheckpoints(); }}
                      />
                    </div>
                  )}
                  {onForkFromCheckpoint && (
                    <button
                      ref={forkTriggerRef}
                      role="menuitem"
                      className={styles.overflowMenuItem}
                      onClick={(e) => { e.stopPropagation(); setShowOverflow(false); handleForkClick(e); }}
                      aria-label={`Fork session ${session.title} from checkpoint`}
                    >
                      <span aria-hidden="true">🍴</span> Fork
                    </button>
                  )}
                  <button
                    role="menuitem"
                    className={styles.overflowMenuItem}
                    onClick={(e) => { e.stopPropagation(); setShowOverflow(false); handleEditTags(e); }}
                    aria-label={`Edit tags for session ${session.title}`}
                  >
                    <span aria-hidden="true">🏷️</span> Edit Tags
                  </button>
                  <button
                    role="menuitem"
                    className={styles.overflowMenuItem}
                    onClick={(e) => { e.stopPropagation(); setShowOverflow(false); onNewWorkspace?.(); }}
                    aria-label={`New workspace from ${session.title}`}
                  >
                    <span aria-hidden="true">➕</span> New Workspace
                  </button>
                  <button
                    role="menuitem"
                    className={styles.overflowMenuItem}
                    onClick={(e) => { e.stopPropagation(); setShowOverflow(false); onDuplicate?.(); }}
                    aria-label={`Duplicate session ${session.title}`}
                  >
                    <span aria-hidden="true">📋</span> Duplicate
                  </button>
                  <button
                    role="menuitem"
                    className={`${styles.overflowMenuItem} ${styles.overflowMenuItemDanger}`}
                    onClick={async (e) => {
                      e.stopPropagation();
                      setShowOverflow(false);
                      setIsDeleting(true);
                      try { await onDelete?.(); } catch { setIsDeleting(false); }
                    }}
                    disabled={isDeleting}
                    aria-label={`Delete session ${session.title}`}
                  >
                    {isDeleting ? "Deleting..." : <><span aria-hidden="true">🗑️</span> Delete</>}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Mobile: accordion toggle + full action list */}
          <button
            className={styles.actionsToggle}
            onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
            aria-expanded={showActions}
            aria-label="Toggle session actions"
          >
            Actions {showActions ? "▲" : "▼"}
          </button>
        <div className={`${styles.actions} ${showActions ? styles.actionsOpen : ""}`}>
          {isPaused ? (
            <button
              className={styles.actionButton}
              onClick={(e) => {
                e.stopPropagation();
                onResume?.();
              }}
              aria-label={`Resume session ${session.title}`}
              title="Resume this session"
            >
              <span aria-hidden="true">▶️</span> Resume
            </button>
          ) : (
            <button
              className={styles.actionButton}
              onClick={(e) => {
                e.stopPropagation();
                onPause?.();
              }}
              aria-label={`Pause session ${session.title}`}
              title="Pause this session"
            >
              <span aria-hidden="true">⏸️</span> Pause
            </button>
          )}
          <button
            className={styles.actionButton}
            onClick={handleRenameClick}
            title="Rename this session"
            aria-label={`Rename session ${session.title}`}
          >
            <span aria-hidden="true">✏️</span> Rename
          </button>
          <button
            className={`${styles.actionButton} ${styles.restartButton}`}
            onClick={handleRestartClick}
            title="Restart this session"
            aria-label={`Restart session ${session.title}`}
          >
            <span aria-hidden="true">🔄</span> Restart
          </button>
          {onCreateCheckpoint && (
            <div onClick={(e) => e.stopPropagation()}>
              <CheckpointButton
                sessionId={session.id}
                isRunning={session.status === SessionStatus.RUNNING}
                onCreateCheckpoint={onCreateCheckpoint}
                onCheckpointCreated={() => refreshCheckpoints()}
              />
            </div>
          )}
          {onForkFromCheckpoint && (
            <button
              className={styles.actionButton}
              onClick={handleForkClick}
              title="Fork this session from a checkpoint"
              aria-label={`Fork session ${session.title} from checkpoint`}
            >
              <span aria-hidden="true">🍴</span> Fork
            </button>
          )}
          {onRunOneShot && (
            <button
              className={styles.actionButton}
              onClick={handleRunOneShot}
              disabled={isRunningOneShot}
              title="Run claude one-shot to create a PR for this session"
              aria-label={`Create PR for session ${session.title}`}
            >
              {isRunningOneShot ? "Creating PR…" : oneShotResult === "done" ? "✅ PR Created" : oneShotResult === "error" ? "❌ Failed – Retry?" : "🚀 Create PR"}
            </button>
          )}
          <button
            className={styles.actionButton}
            onClick={handleEditTags}
            title="Edit session tags"
            aria-label={`Edit tags for session ${session.title}`}
          >
            <span aria-hidden="true">🏷️</span> Edit Tags
          </button>
          <button
            className={styles.actionButton}
            onClick={(e) => {
              e.stopPropagation();
              onNewWorkspace?.();
            }}
            title="New workspace on the same project (same path, fresh title and branch)"
            aria-label={`New workspace from ${session.title}`}
          >
            <span aria-hidden="true">➕</span> New Workspace
          </button>
          <button
            className={styles.actionButton}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate?.();
            }}
            title="Duplicate this session with editable configuration"
            aria-label={`Duplicate session ${session.title}`}
          >
            <span aria-hidden="true">📋</span> Duplicate
          </button>
          <button
            className={`${styles.actionButton} ${styles.deleteButton}`}
            onClick={async (e) => {
              e.stopPropagation();
              setIsDeleting(true);
              try {
                await onDelete?.();
              } catch {
                setIsDeleting(false);
              }
            }}
            disabled={isDeleting}
            aria-label={`Delete session ${session.title}`}
            title="Delete this session"
          >
            {isDeleting ? "Deleting..." : <><span aria-hidden="true">🗑️</span> Delete</>}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
