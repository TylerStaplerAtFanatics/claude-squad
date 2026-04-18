"use client";

import { useState, useRef } from "react";
import { Session, SessionStatus, ReviewItem, InstanceType, RateLimitState, CheckpointProto } from "@/gen/session/v1/types_pb";
import { ReviewQueueBadge } from "./ReviewQueueBadge";
import { GitHubBadge } from "./GitHubBadge";
import { TagEditor } from "./TagEditor";
import {
  card,
  cardDeleting,
  cardSelectMode,
  cardSelected,
  cardExternal,
  checkbox,
  header,
  titleRow,
  title,
  inlineTitleInput,
  badges,
  externalBadge,
  muxIndicator,
  reviewInfo,
  reviewContext,
  status,
  statusRunning,
  statusReady,
  statusPaused,
  statusLoading,
  statusNeedsApproval,
  statusUnknown,
  category,
  tagsContainer,
  tags,
  tag,
  editTagsButton,
  body,
  info,
  infoRow,
  label,
  value,
  githubLink,
  diffStats,
  diffAdded,
  diffRemoved,
  footer,
  timestamps,
  timestamp,
  actions,
  actionsOpen,
  actionsToggle,
  actionButton,
  deleteButton,
  restartButton,
  renameDialog,
  confirmDialog,
  dialogContent,
  warningText,
  renameInput,
  renameLabel,
  errorMessage,
  dialogActions,
  submitButton,
  cancelButton,
  dangerButton,
  forkEmptyMessage,
  forkCheckpointList,
  forkCheckpointItem,
  forkCheckpointLabel,
  forkGitSha,
} from "./SessionCard.css";

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
  onNewWorkspace,
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
  const [isInlineEditing, setIsInlineEditing] = useState(false);
  const [inlineEditValue, setInlineEditValue] = useState("");
  const inlineSavingRef = useRef(false);
  const [checkpointError, setCheckpointError] = useState("");
  const [forkError, setForkError] = useState("");
  const getStatusColor = (sessionStatus: SessionStatus): string => {
    switch (sessionStatus) {
      case SessionStatus.RUNNING:
        return statusRunning;
      case SessionStatus.READY:
        return statusReady;
      case SessionStatus.PAUSED:
        return statusPaused;
      case SessionStatus.LOADING:
        return statusLoading;
      case SessionStatus.NEEDS_APPROVAL:
        return statusNeedsApproval;
      default:
        return statusUnknown;
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
        return statusNeedsApproval;
      case RateLimitState.RECOVERING:
        return statusLoading;
      case RateLimitState.RECOVERED:
        return statusReady;
      case RateLimitState.FAILED:
        return statusPaused;
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

  const handleTitleClick = (e: React.MouseEvent) => {
    if (selectMode) return;
    e.stopPropagation();
    setInlineEditValue(session.title);
    setIsInlineEditing(true);
  };

  const handleInlineSave = async () => {
    if (inlineSavingRef.current) return;
    const trimmed = inlineEditValue.trim();
    if (!trimmed || trimmed === session.title) {
      setIsInlineEditing(false);
      return;
    }
    inlineSavingRef.current = true;
    setIsInlineEditing(false);
    try {
      const success = await onRename?.(session.id, trimmed);
      if (!success) {
        // Re-open inline edit on failure so the user can correct
        setInlineEditValue(trimmed);
        setIsInlineEditing(true);
      }
    } catch {
      setInlineEditValue(trimmed);
      setIsInlineEditing(true);
    } finally {
      inlineSavingRef.current = false;
    }
  };

  const handleInlineKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleInlineSave();
    } else if (e.key === "Escape") {
      setIsInlineEditing(false);
    }
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
        <div className={renameDialog} onClick={(e) => e.stopPropagation()}>
          <div className={dialogContent}>
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
              className={renameInput}
            />
            {renameError && <span className={errorMessage}>{renameError}</span>}
            <div className={dialogActions}>
              <button
                onClick={handleRenameSubmit}
                disabled={isRenaming || !newTitle.trim()}
                className={submitButton}
              >
                {isRenaming ? "Renaming..." : "Rename"}
              </button>
              <button
                onClick={handleRenameCancel}
                disabled={isRenaming}
                className={cancelButton}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {isRestartConfirmOpen && (
        <div className={confirmDialog} onClick={(e) => e.stopPropagation()}>
          <div className={dialogContent}>
            <h3>Restart Session</h3>
            <p>Are you sure you want to restart &quot;{session.title}&quot;?</p>
            <p className={warningText}>This will terminate the current process and start a new one.</p>
            <div className={dialogActions}>
              <button
                onClick={handleRestartConfirm}
                disabled={isRestarting}
                className={dangerButton}
              >
                {isRestarting ? "Restarting..." : "Restart"}
              </button>
              <button
                onClick={handleRestartCancel}
                disabled={isRestarting}
                className={cancelButton}
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
          className={renameDialog}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={dialogContent}>
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
              className={renameInput}
              autoFocus
            />
            {checkpointError && <span className={errorMessage}>{checkpointError}</span>}
            <div className={dialogActions}>
              <button
                onClick={handleCheckpointSubmit}
                disabled={isCreatingCheckpoint || !checkpointLabel.trim()}
                className={submitButton}
              >
                {isCreatingCheckpoint ? "Saving..." : "📍 Save Checkpoint"}
              </button>
              <button
                onClick={handleCheckpointCancel}
                disabled={isCreatingCheckpoint}
                className={cancelButton}
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
          className={renameDialog}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={dialogContent}>
            <h3 id="forkDialogTitle">Fork Session</h3>
            <p>Fork &quot;{session.title}&quot; from a checkpoint into a new independent session.</p>
            <label className={renameLabel}>New session title:</label>
            <input
              type="text"
              value={forkTitle}
              onChange={(e) => setForkTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") handleForkCancel(e as unknown as React.MouseEvent);
              }}
              placeholder="e.g. my-session-fork"
              className={renameInput}
              autoFocus
            />
            {forkCheckpoints.length === 0 ? (
              <p className={forkEmptyMessage}>
                No checkpoints found. Create a checkpoint first.
              </p>
            ) : (
              <ul className={forkCheckpointList}>
                {forkCheckpoints.map((cp) => (
                  <li key={cp.id} className={forkCheckpointItem}>
                    <input
                      type="radio"
                      name="forkCheckpoint"
                      value={cp.id}
                      checked={activeForkCheckpointId === cp.id}
                      onChange={() => setActiveForkCheckpointId(cp.id)}
                      id={`cp-${cp.id}`}
                    />
                    <label htmlFor={`cp-${cp.id}`} className={forkCheckpointLabel}>
                      <strong>{cp.label}</strong>
                      {cp.gitCommitSha && <span className={forkGitSha}>{cp.gitCommitSha.slice(0, 7)}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {forkError && <span className={errorMessage}>{forkError}</span>}
            <div className={dialogActions}>
              {forkCheckpoints.length > 0 && (
                <button
                  className={submitButton}
                  onClick={() => handleForkSubmit(activeForkCheckpointId)}
                  disabled={isForking || !forkTitle.trim() || !activeForkCheckpointId}
                >
                  {isForking ? "Forking..." : "Fork from checkpoint"}
                </button>
              )}
              <button
                onClick={handleForkCancel}
                className={cancelButton}
                disabled={isForking}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    <div
      className={[
        card,
        selectMode ? cardSelectMode : "",
        isSelected ? cardSelected : "",
        isExternal ? cardExternal : "",
        isDeleting ? cardDeleting : "",
      ].filter(Boolean).join(" ")}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Session ${session.title}, status: ${getStatusText(session.status)}, program: ${session.program}`}
      aria-pressed={selectMode ? isSelected : undefined}
    >
      <div className={checkbox} onClick={handleCheckboxClick}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {}} // Controlled by onClick
          aria-label={`Select ${session.title}`}
        />
      </div>
      <div className={header}>
        <div className={titleRow}>
          {isInlineEditing ? (
            <input
              className={inlineTitleInput}
              value={inlineEditValue}
              autoFocus
              onChange={(e) => setInlineEditValue(e.target.value)}
              onBlur={handleInlineSave}
              onKeyDown={handleInlineKeyDown}
              onClick={(e) => e.stopPropagation()}
              aria-label="Edit session title"
            />
          ) : (
            <h3
              className={title}
              onClick={handleTitleClick}
              title={selectMode ? undefined : "Click to rename"}
              style={selectMode ? undefined : { cursor: "text" }}
            >
              {session.title}
            </h3>
          )}
          <div className={badges}>
            {isExternal && (
              <span
                className={externalBadge}
                title={`External session from ${sourceTerminal}${muxEnabled ? " (mux-enabled)" : ""}`}
                aria-label={`External session from ${sourceTerminal}`}
              >
                🔗 {sourceTerminal}
                {muxEnabled && <span className={muxIndicator}>✓</span>}
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
              className={`${status} ${getStatusColor(session.status)}`}
              role="status"
              aria-label={`Session status: ${getStatusText(session.status)}`}
            >
              {getStatusText(session.status)}
            </span>
            {session.rateLimitState && session.rateLimitState !== RateLimitState.NONE && (
              <span
                className={`${status} ${getRateLimitStateColor(session.rateLimitState)}`}
                role="status"
                aria-label={`Rate limit: ${getRateLimitStateText(session.rateLimitState)}`}
              >
                {getRateLimitStateText(session.rateLimitState)}
              </span>
            )}
          </div>
        </div>
        {session.category && (
          <span className={category}>{session.category}</span>
        )}
        <div className={tagsContainer}>
          {session.tags && session.tags.length > 0 && (
            <div className={tags}>
              {session.tags.map((sessionTag, index) => (
                <span key={index} className={tag}>
                  {sessionTag}
                </span>
              ))}
            </div>
          )}
          <button
            className={editTagsButton}
            onClick={handleEditTags}
            title="Edit tags"
          >
            {session.tags && session.tags.length > 0 ? "Edit Tags" : "Add Tags"}
          </button>
        </div>
        {reviewItem && !selectMode && (
          <div className={reviewInfo}>
            <ReviewQueueBadge
              priority={reviewItem.priority}
              reason={reviewItem.reason}
              compact={false}
            />
            {reviewItem.context && (
              <span className={reviewContext}>{reviewItem.context}</span>
            )}
          </div>
        )}
      </div>

      <div className={body}>
        <div className={info}>
          <div className={infoRow}>
            <span className={label}>Program:</span>
            <span className={value}>{session.program}</span>
          </div>
          <div className={infoRow}>
            <span className={label}>Branch:</span>
            <span className={value}>{session.branch}</span>
          </div>
          <div className={infoRow}>
            <span className={label}>Path:</span>
            <span className={value} title={session.path}>
              {session.path}
            </span>
          </div>
          {session.workingDir && (
            <div className={infoRow}>
              <span className={label}>Working Dir:</span>
              <span className={value}>{session.workingDir}</span>
            </div>
          )}
          {session.githubOwner && session.githubRepo && (
            <div className={infoRow}>
              <span className={label}>Repository:</span>
              <span className={value}>
                <a
                  href={`https://github.com/${session.githubOwner}/${session.githubRepo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={githubLink}
                >
                  {session.githubOwner}/{session.githubRepo}
                </a>
              </span>
            </div>
          )}
          {session.githubPrNumber > 0 && session.githubPrUrl && (
            <div className={infoRow}>
              <span className={label}>Pull Request:</span>
              <span className={value}>
                <a
                  href={session.githubPrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={githubLink}
                >
                  #{session.githubPrNumber}
                </a>
              </span>
            </div>
          )}
          {session.clonedRepoPath && (
            <div className={infoRow}>
              <span className={label}>Cloned To:</span>
              <span className={value} title={session.clonedRepoPath}>
                {session.clonedRepoPath}
              </span>
            </div>
          )}
        </div>

        {session.diffStats && (
          <div className={diffStats}>
            <span className={diffAdded}>+{session.diffStats.added}</span>
            <span className={diffRemoved}>-{session.diffStats.removed}</span>
          </div>
        )}
      </div>

      <div className={footer}>
        <div className={timestamps}>
          <span className={timestamp}>
            Created: <time dateTime={session.createdAt ? new Date(Number(session.createdAt.seconds) * 1000).toISOString() : ""}>{formatDate(session.createdAt)}</time>
          </span>
          <span className={timestamp}>
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
              <span className={timestamp} title="Last terminal activity">
                Last Activity: <time dateTime={new Date(Number(lastActivity.seconds) * 1000).toISOString()}>{formatTimeAgo(lastActivity)}</time>
              </span>
            ) : null;
          })()}
        </div>

          <button
            className={actionsToggle}
            onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
            aria-expanded={showActions}
            aria-label="Toggle session actions"
          >
            Actions {showActions ? "▲" : "▼"}
          </button>
        <div className={`${actions} ${showActions ? actionsOpen : ""}`}>
          {isPaused ? (
            <button
              className={actionButton}
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
              className={actionButton}
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
            className={actionButton}
            onClick={handleRenameClick}
            title="Rename this session"
            aria-label={`Rename session ${session.title}`}
          >
            ✏️ Rename
          </button>
          <button
            className={`${actionButton} ${restartButton}`}
            onClick={handleRestartClick}
            title="Restart this session"
            aria-label={`Restart session ${session.title}`}
          >
            🔄 Restart
          </button>
          {onCreateCheckpoint && (
            <button
              className={actionButton}
              onClick={handleCheckpointClick}
              title="Save a named checkpoint of the current session state"
              aria-label={`Create checkpoint for session ${session.title}`}
            >
              📍 Checkpoint
            </button>
          )}
          {onForkFromCheckpoint && (
            <button
              className={actionButton}
              onClick={handleForkClick}
              title="Fork this session from a checkpoint"
              aria-label={`Fork session ${session.title} from checkpoint`}
            >
              🍴 Fork
            </button>
          )}
          <button
            className={actionButton}
            onClick={(e) => {
              e.stopPropagation();
              onNewWorkspace?.();
            }}
            title="New workspace on the same project (same path, fresh title and branch)"
            aria-label={`New workspace from ${session.title}`}
          >
            ➕ New Workspace
          </button>
          <button
            className={actionButton}
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
            className={`${actionButton} ${deleteButton}`}
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
