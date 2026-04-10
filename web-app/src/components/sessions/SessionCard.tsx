"use client";

import { useState } from "react";
import { Session, SessionStatus, ReviewItem, InstanceType, CheckpointProto } from "@/gen/session/v1/types_pb";
import { ReviewQueueBadge } from "./ReviewQueueBadge";
import { GitHubBadge } from "./GitHubBadge";
import { TagEditor } from "./TagEditor";
import styles from "./SessionCard.module.css";

interface SessionCardProps {
  session: Session;
  onClick?: () => void;
  onDelete?: () => Promise<void> | void;
  onPause?: () => void;
  onResume?: () => void;
  onDuplicate?: () => void;
  onRename?: (sessionId: string, newTitle: string) => Promise<boolean>;
  onRestart?: (sessionId: string) => Promise<boolean>;
  onUpdateTags?: (sessionId: string, tags: string[]) => void;
  onCreateCheckpoint?: (sessionId: string, label: string) => Promise<boolean>;
  onListCheckpoints?: (sessionId: string) => Promise<CheckpointProto[]>;
  onForkFromCheckpoint?: (sessionId: string, checkpointId: string, newTitle: string) => Promise<Session | null>;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  reviewItem?: ReviewItem; // Optional review queue item if session needs attention
}

export function SessionCard({
  session,
  onClick,
  onDelete,
  onPause,
  onResume,
  onDuplicate,
  onRename,
  onRestart,
  onUpdateTags,
  onCreateCheckpoint,
  onListCheckpoints,
  onForkFromCheckpoint,
  selectMode = false,
  isSelected = false,
  onToggleSelect,
  reviewItem,
}: SessionCardProps) {
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [newTitle, setNewTitle] = useState(session.title);
  const [isRestartConfirmOpen, setIsRestartConfirmOpen] = useState(false);
  const [isCheckpointOpen, setIsCheckpointOpen] = useState(false);
  const [checkpointLabel, setCheckpointLabel] = useState("");
  const [isCreatingCheckpoint, setIsCreatingCheckpoint] = useState(false);
  const [isForkOpen, setIsForkOpen] = useState(false);
  const [forkCheckpoints, setForkCheckpoints] = useState<CheckpointProto[]>([]);
  const [forkTitle, setForkTitle] = useState("");
  const [activeForkCheckpointId, setActiveForkCheckpointId] = useState("");
  const [isForking, setIsForking] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [checkpointError, setCheckpointError] = useState("");
  const [forkError, setForkError] = useState("");
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
  const isExternal = session.instanceType === InstanceType.EXTERNAL;
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

  const handleCheckpointClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCheckpointLabel("");
    setIsCheckpointOpen(true);
  };

  const handleCheckpointSubmit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!checkpointLabel.trim()) return;
    setIsCreatingCheckpoint(true);
    setCheckpointError("");
    try {
      const success = await onCreateCheckpoint?.(session.id, checkpointLabel.trim());
      if (success) {
        setIsCheckpointOpen(false);
      } else {
        setCheckpointError("Failed to create checkpoint");
      }
    } catch (error) {
      setCheckpointError(error instanceof Error ? error.message : "Failed to create checkpoint");
    } finally {
      setIsCreatingCheckpoint(false);
    }
  };

  const handleCheckpointCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCheckpointOpen(false);
    setCheckpointError("");
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
      {isRenameOpen && (
        <div className={styles.renameDialog} onClick={(e) => e.stopPropagation()}>
          <div className={styles.dialogContent}>
            <h3>Rename Session</h3>
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
        </div>
      )}
      {isRestartConfirmOpen && (
        <div className={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
          <div className={styles.dialogContent}>
            <h3>Restart Session</h3>
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
        </div>
      )}
      {isCheckpointOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkpointDialogTitle"
          className={styles.renameDialog}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.dialogContent}>
            <h3 id="checkpointDialogTitle">Create Checkpoint</h3>
            <p>Enter a label for this checkpoint of &quot;{session.title}&quot;:</p>
            <input
              type="text"
              value={checkpointLabel}
              onChange={(e) => setCheckpointLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCheckpointSubmit(e as unknown as React.MouseEvent);
                if (e.key === "Escape") handleCheckpointCancel(e as unknown as React.MouseEvent);
              }}
              placeholder="e.g. before refactor, working state"
              className={styles.renameInput}
              autoFocus
            />
            {checkpointError && <span className={styles.errorMessage}>{checkpointError}</span>}
            <div className={styles.dialogActions}>
              <button
                onClick={handleCheckpointSubmit}
                disabled={isCreatingCheckpoint || !checkpointLabel.trim()}
                className={styles.submitButton}
              >
                {isCreatingCheckpoint ? "Saving..." : "📍 Save Checkpoint"}
              </button>
              <button
                onClick={handleCheckpointCancel}
                disabled={isCreatingCheckpoint}
                className={styles.cancelButton}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {isForkOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="forkDialogTitle"
          className={styles.renameDialog}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.dialogContent}>
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
        </div>
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
          </div>
        </div>
        {session.category && (
          <span className={styles.category}>{session.category}</span>
        )}
        <div className={styles.tagsContainer}>
          {session.tags && session.tags.length > 0 && (
            <div className={styles.tags}>
              {session.tags.map((tag, index) => (
                <span key={index} className={styles.tag}>
                  {tag}
                </span>
              ))}
            </div>
          )}
          <button
            className={styles.editTagsButton}
            onClick={handleEditTags}
            title="Edit tags"
          >
            {session.tags && session.tags.length > 0 ? "Edit Tags" : "Add Tags"}
          </button>
        </div>
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
      </div>

      <div className={styles.body}>
        <div className={styles.info}>
          <div className={styles.infoRow}>
            <span className={styles.label}>Program:</span>
            <span className={styles.value}>{session.program}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Branch:</span>
            <span className={styles.value}>{session.branch}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>Path:</span>
            <span className={styles.value} title={session.path}>
              {session.path}
            </span>
          </div>
          {session.workingDir && (
            <div className={styles.infoRow}>
              <span className={styles.label}>Working Dir:</span>
              <span className={styles.value}>{session.workingDir}</span>
            </div>
          )}
          {session.githubOwner && session.githubRepo && (
            <div className={styles.infoRow}>
              <span className={styles.label}>Repository:</span>
              <span className={styles.value}>
                <a
                  href={`https://github.com/${session.githubOwner}/${session.githubRepo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={styles.githubLink}
                >
                  {session.githubOwner}/{session.githubRepo}
                </a>
              </span>
            </div>
          )}
          {session.githubPrNumber > 0 && session.githubPrUrl && (
            <div className={styles.infoRow}>
              <span className={styles.label}>Pull Request:</span>
              <span className={styles.value}>
                <a
                  href={session.githubPrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={styles.githubLink}
                >
                  #{session.githubPrNumber}
                </a>
              </span>
            </div>
          )}
          {session.clonedRepoPath && (
            <div className={styles.infoRow}>
              <span className={styles.label}>Cloned To:</span>
              <span className={styles.value} title={session.clonedRepoPath}>
                {session.clonedRepoPath}
              </span>
            </div>
          )}
        </div>

        {session.diffStats && (
          <div className={styles.diffStats}>
            <span className={styles.diffAdded}>+{session.diffStats.added}</span>
            <span className={styles.diffRemoved}>-{session.diffStats.removed}</span>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <div className={styles.timestamps}>
          <span className={styles.timestamp}>
            Created: <time dateTime={session.createdAt ? new Date(Number(session.createdAt.seconds) * 1000).toISOString() : ""}>{formatDate(session.createdAt)}</time>
          </span>
          <span className={styles.timestamp}>
            Updated: <time dateTime={session.updatedAt ? new Date(Number(session.updatedAt.seconds) * 1000).toISOString() : ""}>{formatDate(session.updatedAt)}</time>
          </span>
          {(() => {
            // Use the most recent of lastMeaningfulOutput and lastTerminalUpdate.
            // lastMeaningfulOutput is gated by a content-signature check, so it can lag
            // behind lastTerminalUpdate when content repeats (e.g. idle prompt).
            const moSecs = session.lastMeaningfulOutput?.seconds ?? BigInt(0);
            const tuSecs = session.lastTerminalUpdate?.seconds ?? BigInt(0);
            const lastActivity = moSecs === BigInt(0) && tuSecs === BigInt(0)
              ? undefined
              : moSecs >= tuSecs ? session.lastMeaningfulOutput : session.lastTerminalUpdate;
            return lastActivity ? (
              <span className={styles.timestamp} title="Last terminal activity">
                Last Activity: <time dateTime={new Date(Number(lastActivity.seconds) * 1000).toISOString()}>{formatTimeAgo(lastActivity)}</time>
              </span>
            ) : null;
          })()}
        </div>

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
              ▶️ Resume
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
              ⏸️ Pause
            </button>
          )}
          <button
            className={styles.actionButton}
            onClick={handleRenameClick}
            title="Rename this session"
            aria-label={`Rename session ${session.title}`}
          >
            ✏️ Rename
          </button>
          <button
            className={`${styles.actionButton} ${styles.restartButton}`}
            onClick={handleRestartClick}
            title="Restart this session"
            aria-label={`Restart session ${session.title}`}
          >
            🔄 Restart
          </button>
          {onCreateCheckpoint && (
            <button
              className={styles.actionButton}
              onClick={handleCheckpointClick}
              title="Save a named checkpoint of the current session state"
              aria-label={`Create checkpoint for session ${session.title}`}
            >
              📍 Checkpoint
            </button>
          )}
          {onForkFromCheckpoint && (
            <button
              className={styles.actionButton}
              onClick={handleForkClick}
              title="Fork this session from a checkpoint"
              aria-label={`Fork session ${session.title} from checkpoint`}
            >
              🍴 Fork
            </button>
          )}
          <button
            className={styles.actionButton}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate?.();
            }}
            title="Duplicate this session with editable configuration"
            aria-label={`Duplicate session ${session.title}`}
          >
            📋 Duplicate
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
            {isDeleting ? "Deleting..." : "🗑️ Delete"}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
