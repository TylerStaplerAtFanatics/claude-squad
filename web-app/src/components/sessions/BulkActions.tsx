"use client";

import styles from "./BulkActions.module.css";

interface BulkActionsProps {
  selectedCount: number;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onStopAll: () => void;
  onDeleteAll: () => void;
  onAddTagAll: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  totalCount: number;
  feedback?: string | null;
}

export function BulkActions({
  selectedCount,
  onPauseAll,
  onResumeAll,
  onStopAll,
  onDeleteAll,
  onAddTagAll,
  onSelectAll,
  onClearSelection,
  totalCount,
  feedback,
}: BulkActionsProps) {
  if (selectedCount === 0) return null;

  return (
    <div className={styles.container}>
      {feedback && <div className={styles.feedback}>{feedback}</div>}
      <div className={styles.selection}>
        <span className={styles.count}>
          {selectedCount} of {totalCount} selected
        </span>
        {selectedCount < totalCount && (
          <button onClick={onSelectAll} className={styles.selectAllButton}>
            Select All
          </button>
        )}
        <button onClick={onClearSelection} className={styles.clearButton}>
          Clear Selection
        </button>
      </div>

      <div className={styles.actions}>
        <button
          onClick={onPauseAll}
          className={styles.actionButton}
        >
          ⏸️ Pause Selected
        </button>
        <button
          onClick={onResumeAll}
          className={styles.actionButton}
        >
          ▶️ Resume Selected
        </button>
        <button
          onClick={onStopAll}
          className={styles.actionButton}
        >
          ⏹️ Stop Selected
        </button>
        <button
          onClick={onAddTagAll}
          className={styles.actionButton}
        >
          🏷️ Add Tag
        </button>
        <button
          onClick={onDeleteAll}
          className={`${styles.actionButton} ${styles.danger}`}
        >
          🗑️ Delete Selected
        </button>
      </div>
    </div>
  );
}
