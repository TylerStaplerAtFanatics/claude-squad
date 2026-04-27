"use client";

import {
  container, selection, count, selectAllButton, clearButton, actions, actionButton, danger, feedback as feedbackClass,
} from "./BulkActions.css";

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
    <div className={container}>
      {feedback && <div className={feedbackClass} role="status" aria-live="polite" aria-atomic="true">{feedback}</div>}
      <div className={selection}>
        <span className={count}>
          {selectedCount} of {totalCount} selected
        </span>
        {selectedCount < totalCount && (
          <button onClick={onSelectAll} className={selectAllButton}>
            Select All
          </button>
        )}
        <button onClick={onClearSelection} className={clearButton}>
          Clear Selection
        </button>
      </div>

      <div className={actions}>
        <button
          onClick={onPauseAll}
          className={actionButton}
        >
          ⏸️ Pause Selected
        </button>
        <button
          onClick={onResumeAll}
          className={actionButton}
        >
          ▶️ Resume Selected
        </button>
        <button
          onClick={onStopAll}
          className={actionButton}
        >
          ⏹️ Stop Selected
        </button>
        <button
          onClick={onAddTagAll}
          className={actionButton}
        >
          🏷️ Add Tag
        </button>
        <button
          onClick={onDeleteAll}
          className={`${actionButton} ${danger}`}
        >
          🗑️ Delete Selected
        </button>
      </div>
    </div>
  );
}
