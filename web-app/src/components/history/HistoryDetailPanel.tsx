"use client";

import { ClaudeHistoryEntry, ClaudeMessage } from "@/gen/session/v1/session_pb";
import { formatDate } from "@/lib/utils/timestamp";
import styles from "./HistoryDetailPanel.module.css";

interface HistoryDetailPanelProps {
  entry: ClaudeHistoryEntry | null;
  previewMessages: ClaudeMessage[];
  loadingPreview: boolean;
  loadingMessages: boolean;
  resuming: boolean;
  onResume: (entry: ClaudeHistoryEntry) => void;
  onViewMessages: (id: string) => void;
  onExport: (entry: ClaudeHistoryEntry) => void;
  onCopyId: (id: string) => void;
}

export function HistoryDetailPanel({
  entry,
  previewMessages,
  loadingPreview,
  loadingMessages,
  resuming,
  onResume,
  onViewMessages,
  onExport,
  onCopyId,
}: HistoryDetailPanelProps) {
  if (!entry) {
    return (
      <div className={styles.detailPanel}>
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>👆</div>
          <p>Select an entry to view details</p>
          <p className="text-muted" style={{ fontSize: "12px", marginTop: "10px" }}>
            Use ↑↓ or j/k to navigate
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.detailPanel}>
      <div>
        <h2 className={styles.sectionTitle}>Entry Details</h2>
        <div className={styles.detailFields}>
          <div className={styles.detailField}>
            <div className={styles.fieldLabel}>Name:</div>
            <div className="text-primary">{entry.name}</div>
          </div>
          <div className={styles.detailField}>
            <div className={styles.fieldLabel}>ID:</div>
            <div className={styles.idField}>
              <code className="text-muted">{entry.id.substring(0, 8)}...</code>
              <button
                onClick={() => onCopyId(entry.id)}
                className={styles.copyButton}
                title="Copy full ID"
              >
                📋
              </button>
            </div>
          </div>
          {entry.project && (
            <div className={styles.detailField}>
              <div className={styles.fieldLabel}>Project:</div>
              <div className={styles.projectPath} title={entry.project}>
                {entry.project}
              </div>
            </div>
          )}
          {entry.vcsStatus && (
            <div className={styles.detailField}>
              <div className={styles.fieldLabel}>Git State</div>
              <div className={styles.vcsSection}>
                <div className={styles.vcsRow}>
                  <span className={styles.vcsLabel}>Branch:</span>
                  <span className={styles.vcsBranch}>⎇ {entry.vcsStatus.branch || "(detached)"}</span>
                </div>
                <div className={styles.vcsRow}>
                  <span className={styles.vcsLabel}>Status:</span>
                  <span className={entry.vcsStatus.isClean ? styles.vcsClean : styles.vcsDirty}>
                    {entry.vcsStatus.isClean ? "✓ Clean" : "✦ Uncommitted changes"}
                  </span>
                </div>
                {!entry.vcsStatus.isClean && (
                  <div className={styles.vcsChanges}>
                    {entry.vcsStatus.hasStaged && (
                      <span className={styles.vcsStat} title="Staged files">
                        +{entry.vcsStatus.stagedFiles.length} staged
                      </span>
                    )}
                    {entry.vcsStatus.hasUnstaged && (
                      <span className={styles.vcsStat} title="Modified files">
                        ~{entry.vcsStatus.unstagedFiles.length} modified
                      </span>
                    )}
                    {entry.vcsStatus.hasUntracked && (
                      <span className={styles.vcsStat} title="Untracked files">
                        ?{entry.vcsStatus.untrackedFiles.length} untracked
                      </span>
                    )}
                  </div>
                )}
                {(entry.vcsStatus.aheadBy > 0 || entry.vcsStatus.behindBy > 0) && (
                  <div className={styles.vcsRow}>
                    <span className={styles.vcsLabel}>Remote:</span>
                    <span className={styles.vcsRemote}>
                      {entry.vcsStatus.aheadBy > 0 && `↑${entry.vcsStatus.aheadBy} ahead`}
                      {entry.vcsStatus.aheadBy > 0 && entry.vcsStatus.behindBy > 0 && " · "}
                      {entry.vcsStatus.behindBy > 0 && `↓${entry.vcsStatus.behindBy} behind`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className={styles.detailField}>
            <div className={styles.fieldLabel}>Model:</div>
            <div className="text-primary">{entry.model}</div>
          </div>
          <div className={styles.detailField}>
            <div className={styles.fieldLabel}>Message Count:</div>
            <div className="text-primary">{entry.messageCount}</div>
          </div>
          <div className={styles.detailField}>
            <div className={styles.fieldLabel}>Created:</div>
            <div className="text-secondary" style={{ fontSize: "13px" }}>
              {formatDate(entry.createdAt)}
            </div>
          </div>
          <div className={styles.detailField}>
            <div className={styles.fieldLabel}>Last Updated:</div>
            <div className="text-secondary" style={{ fontSize: "13px" }}>
              {formatDate(entry.updatedAt)}
            </div>
          </div>

          {/* Message Preview */}
          <div className={styles.messagePreview}>
            <div className={styles.previewHeader}>
              <span className={styles.fieldLabel}>Recent Messages</span>
              {loadingPreview && <span className="text-muted" style={{ fontSize: "12px" }}>Loading...</span>}
            </div>
            {previewMessages.length > 0 ? (
              <div className={styles.previewMessages}>
                {previewMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`${styles.previewMessage} ${msg.role === "user" ? styles.userMessage : styles.assistantMessage}`}
                  >
                    <div className={styles.previewRole}>
                      {msg.role === "user" ? "👤" : "🤖"}
                    </div>
                    <div className={styles.previewContent}>
                      {msg.content.length > 200
                        ? msg.content.substring(0, 200) + "..."
                        : msg.content}
                    </div>
                  </div>
                ))}
                {entry.messageCount > 5 && (
                  <button
                    onClick={() => onViewMessages(entry.id)}
                    className={styles.viewMoreButton}
                  >
                    View all {entry.messageCount} messages →
                  </button>
                )}
              </div>
            ) : !loadingPreview ? (
              <div className="text-muted" style={{ fontSize: "12px", fontStyle: "italic" }}>
                No messages available
              </div>
            ) : null}
          </div>

          {/* Action Buttons */}
          <div className={styles.detailActions}>
            <button
              onClick={() => onResume(entry)}
              disabled={resuming || !entry.project}
              className="btn btn-primary"
              title={entry.project ? "Start a new session resuming this conversation" : "Cannot resume: No project path"}
            >
              {resuming ? "Starting..." : "▶️ Resume Session"}
            </button>
            <button
              onClick={() => onViewMessages(entry.id)}
              disabled={loadingMessages}
              className="btn btn-secondary"
            >
              {loadingMessages ? "Loading..." : "💬 View Messages"}
            </button>
            <button
              onClick={() => onExport(entry)}
              className="btn btn-secondary"
              title="Export conversation as JSON"
            >
              📥 Export
            </button>
            <button
              onClick={() => onCopyId(entry.id)}
              className="btn btn-secondary"
              title="Copy conversation ID"
            >
              📋 Copy ID
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
