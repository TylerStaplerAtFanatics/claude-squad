"use client";

import { useState, useMemo } from "react";
import { useSessionVcsContext } from "@/lib/contexts/SessionVcsContext";
import styles from "./DiffViewer.module.css";

interface DiffViewerProps {
  // Props kept for backward compatibility but data now comes from SessionVcsContext.
}

interface DiffFile {
  filename: string;
  additions: number;
  deletions: number;
  changes: DiffHunk[];
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: "add" | "delete" | "context";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

// Parse unified diff format from git
function parseDiff(diffContent: string): DiffFile[] {
  if (!diffContent || diffContent.trim() === "") {
    return [];
  }

  const files: DiffFile[] = [];
  const lines = diffContent.split("\n");
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // File header: diff --git a/file b/file
    if (line.startsWith("diff --git")) {
      if (currentFile && currentHunk) {
        currentFile.changes.push(currentHunk);
      }
      if (currentFile) {
        files.push(currentFile);
      }
      currentFile = {
        filename: "",
        additions: 0,
        deletions: 0,
        changes: [],
      };
      currentHunk = null;
    }
    // +++ b/filename
    else if (line.startsWith("+++")) {
      const match = line.match(/\+\+\+ b\/(.*)/);
      if (match && currentFile) {
        currentFile.filename = match[1];
      }
    }
    // Hunk header: @@ -10,5 +10,7 @@
    else if (line.startsWith("@@")) {
      if (currentFile && currentHunk) {
        currentFile.changes.push(currentHunk);
      }
      const match = line.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1]),
          oldLines: parseInt(match[2]),
          newStart: parseInt(match[3]),
          newLines: parseInt(match[4]),
          lines: [],
        };
        oldLineNum = parseInt(match[1]);
        newLineNum = parseInt(match[3]);
      }
    }
    // Diff line content
    else if (currentHunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({
          type: "add",
          content: line,
          newLineNumber: newLineNum++,
        });
        if (currentFile) currentFile.additions++;
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({
          type: "delete",
          content: line,
          oldLineNumber: oldLineNum++,
        });
        if (currentFile) currentFile.deletions++;
      } else {
        currentHunk.lines.push({
          type: "context",
          content: line,
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++,
        });
      }
    }
  }

  // Push last file and hunk
  if (currentFile && currentHunk) {
    currentFile.changes.push(currentHunk);
  }
  if (currentFile) {
    files.push(currentFile);
  }

  return files;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function DiffViewer(_props: DiffViewerProps) {
  const { diff: rawDiff, diffLoading: loading, refreshDiff } = useSessionVcsContext();
  const [viewMode, setViewMode] = useState<"split" | "unified">("unified");

  const diff = useMemo(() => parseDiff(rawDiff?.content ?? ""), [rawDiff?.content]);
  const totalAdditions = rawDiff?.added ?? 0;
  const totalDeletions = rawDiff?.removed ?? 0;

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading diff...</div>
      </div>
    );
  }

  if (diff.length === 0 && !loading) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <p>No changes to display</p>
          <p className={styles.emptyHint}>
            Diff will show here when there are uncommitted changes in the session.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.stats}>
          <span className={styles.filesChanged}>
            {diff.length} {diff.length === 1 ? "file" : "files"} changed
          </span>
          <span className={styles.additions}>+{totalAdditions}</span>
          <span className={styles.deletions}>-{totalDeletions}</span>
        </div>
        <button className={styles.viewModeButton} onClick={refreshDiff} title="Refresh diff">
          ↺
        </button>
        <div className={styles.viewModeToggle}>
          <button
            className={`${styles.viewModeButton} ${
              viewMode === "unified" ? styles.active : ""
            }`}
            onClick={() => setViewMode("unified")}
            aria-label="Unified diff view"
          >
            Unified
          </button>
          <button
            className={`${styles.viewModeButton} ${
              viewMode === "split" ? styles.active : ""
            }`}
            onClick={() => setViewMode("split")}
            disabled
            title="Split view coming soon"
            aria-label="Split diff view (coming soon)"
          >
            Split
          </button>
        </div>
      </div>

      <div className={styles.diffContent}>
        {diff.map((file, fileIndex) => (
          <div key={fileIndex} className={styles.file}>
            <div className={styles.fileHeader}>
              <span className={styles.filename}>{file.filename}</span>
              <span className={styles.fileStats}>
                <span className={styles.additions}>+{file.additions}</span>
                <span className={styles.deletions}>-{file.deletions}</span>
              </span>
            </div>

            {file.changes.map((hunk, hunkIndex) => (
              <div key={hunkIndex} className={styles.hunk}>
                <div className={styles.hunkHeader}>
                  @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
                  {hunk.newLines} @@
                </div>
                <div className={styles.lines}>
                  {hunk.lines.map((line, lineIndex) => (
                    <div
                      key={lineIndex}
                      className={`${styles.line} ${styles[line.type]}`}
                    >
                      {viewMode === "unified" && (
                        <>
                          <span className={styles.lineNumber}>
                            {line.oldLineNumber !== undefined ? line.oldLineNumber : " "}
                          </span>
                          <span className={styles.lineNumber}>
                            {line.newLineNumber !== undefined ? line.newLineNumber : " "}
                          </span>
                        </>
                      )}
                      <span className={styles.lineContent}>{line.content}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
