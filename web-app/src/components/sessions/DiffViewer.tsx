"use client";

import { useState, useMemo } from "react";
import { useSessionVcsContext } from "@/lib/contexts/SessionVcsContext";
import {
  container,
  toolbar,
  stats,
  filesChanged,
  additions,
  deletions,
  viewModeToggle,
  viewModeButton,
  viewModeButtonActive,
  diffContent,
  file,
  fileHeader,
  filename,
  fileStats,
  hunk,
  hunkHeader,
  lines,
  line,
  lineAdd,
  lineDelete,
  lineContext,
  lineNumber,
  lineContent,
  loading as loadingClass,
  empty as emptyClass,
  emptyHint,
} from "./DiffViewer.css";

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

  const getLineClass = (type: DiffLine["type"]): string => {
    if (type === "add") return lineAdd;
    if (type === "delete") return lineDelete;
    return lineContext;
  };

  if (loading) {
    return (
      <div className={container}>
        <div className={loadingClass}>Loading diff...</div>
      </div>
    );
  }

  if (diff.length === 0 && !loading) {
    return (
      <div className={container}>
        <div className={emptyClass}>
          <p>No changes to display</p>
          <p className={emptyHint}>
            Diff will show here when there are uncommitted changes in the session.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={container}>
      <div className={toolbar}>
        <div className={stats}>
          <span className={filesChanged}>
            {diff.length} {diff.length === 1 ? "file" : "files"} changed
          </span>
          <span className={additions}>+{totalAdditions}</span>
          <span className={deletions}>-{totalDeletions}</span>
        </div>
        <button className={viewModeButton} onClick={refreshDiff} title="Refresh diff">
          ↺
        </button>
        <div className={viewModeToggle}>
          <button
            className={`${viewModeButton} ${viewMode === "unified" ? viewModeButtonActive : ""}`}
            onClick={() => setViewMode("unified")}
            aria-label="Unified diff view"
          >
            Unified
          </button>
          <button
            className={`${viewModeButton} ${viewMode === "split" ? viewModeButtonActive : ""}`}
            onClick={() => setViewMode("split")}
            disabled
            title="Split view coming soon"
            aria-label="Split diff view (coming soon)"
          >
            Split
          </button>
        </div>
      </div>

      <div className={diffContent}>
        {diff.map((diffFile, fileIndex) => (
          <div key={fileIndex} className={file}>
            <div className={fileHeader}>
              <span className={filename}>{diffFile.filename}</span>
              <span className={fileStats}>
                <span className={additions}>+{diffFile.additions}</span>
                <span className={deletions}>-{diffFile.deletions}</span>
              </span>
            </div>

            {diffFile.changes.map((diffHunk, hunkIndex) => (
              <div key={hunkIndex} className={hunk}>
                <div className={hunkHeader}>
                  @@ -{diffHunk.oldStart},{diffHunk.oldLines} +{diffHunk.newStart},
                  {diffHunk.newLines} @@
                </div>
                <div className={lines}>
                  {diffHunk.lines.map((diffLine, lineIndex) => (
                    <div
                      key={lineIndex}
                      className={`${line} ${getLineClass(diffLine.type)}`}
                    >
                      {viewMode === "unified" && (
                        <>
                          <span className={lineNumber}>
                            {diffLine.oldLineNumber !== undefined ? diffLine.oldLineNumber : " "}
                          </span>
                          <span className={lineNumber}>
                            {diffLine.newLineNumber !== undefined ? diffLine.newLineNumber : " "}
                          </span>
                        </>
                      )}
                      <span className={lineContent}>{diffLine.content}</span>
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
