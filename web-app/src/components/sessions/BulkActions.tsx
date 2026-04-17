"use client";

import {
  container, selection, count, selectAllButton, clearButton, actions, actionButton, danger,
} from "./BulkActions.css";

interface BulkActionsProps {
  selectedCount: number;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onDeleteAll: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  totalCount: number;
}

export function BulkActions({
  selectedCount,
  onPauseAll,
  onResumeAll,
  onDeleteAll,
  onSelectAll,
  onClearSelection,
  totalCount,
}: BulkActionsProps) {
  return (
    <div className={container}>
      <div className={selection}>
        <span className={count}>
          {selectedCount} of {totalCount} selected
        </span>
        {selectedCount < totalCount && (
          <button onClick={onSelectAll} className={selectAllButton}>
            Select All
          </button>
        )}
        {selectedCount > 0 && (
          <button onClick={onClearSelection} className={clearButton}>
            Clear Selection
          </button>
        )}
      </div>

      <div className={actions}>
        <button
          onClick={onPauseAll}
          className={actionButton}
          disabled={selectedCount === 0}
        >
          ⏸️ Pause Selected
        </button>
        <button
          onClick={onResumeAll}
          className={actionButton}
          disabled={selectedCount === 0}
        >
          ▶️ Resume Selected
        </button>
        <button
          onClick={onDeleteAll}
          className={`${actionButton} ${danger}`}
          disabled={selectedCount === 0}
        >
          🗑️ Delete Selected
        </button>
      </div>
    </div>
  );
}
