"use client";

import { useState, useEffect } from "react";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { SessionService } from "@/gen/session/v1/session_pb";
import styles from "./DiffViewer.module.css";

interface DiffViewerProps {
  sessionId: string;
  baseUrl: string;
}

// ---- Module-level diff cache ----

interface DiffCacheEntry {
  files: DiffFile[];
  additions: number;
  deletions: number;
  rawContent: string;
  timestamp: number;
}

const diffCache = new Map<string, DiffCacheEntry>();
const DIFF_CACHE_TTL_MS = 30_000;

function getDiffCached(sessionId: string): DiffCacheEntry | null {
  const entry = diffCache.get(sessionId);
  if (entry && Date.now() - entry.timestamp < DIFF_CACHE_TTL_MS) return entry;
  return null;
}

/**
 * Warm the diff cache for a session without rendering anything.
 * Call from SessionDetail when a session is selected.
 */
export async function prefetchDiff(sessionId: string, baseUrl: string): Promise<void> {
  if (getDiffCached(sessionId)) return;
  try {
    const client = createClient(SessionService, createConnectTransport({ baseUrl }));
    const response = await client.getSessionDiff({ id: sessionId });
    diffCache.set(sessionId, {
      files: parseDiff(response.diffStats?.content ?? ""),
      additions: response.diffStats?.added ?? 0,
      deletions: response.diffStats?.removed ?? 0,
      rawContent: response.diffStats?.content ?? "",
      timestamp: Date.now(),
    });
  } catch {
    // Prefetch failures are silent – the component will retry on mount.
  }
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

export function DiffViewer({ sessionId, baseUrl }: DiffViewerProps) {
  const initialCached = getDiffCached(sessionId);
  const [diff, setDiff] = useState<DiffFile[]>(initialCached?.files ?? []);
  const [loading, setLoading] = useState(!initialCached);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"split" | "unified">("unified");
  const [rawDiffContent, setRawDiffContent] = useState<string>(initialCached?.rawContent ?? "");
  const [totalAdditions, setTotalAdditions] = useState(initialCached?.additions ?? 0);
  const [totalDeletions, setTotalDeletions] = useState(initialCached?.deletions ?? 0);

  useEffect(() => {
    const fetchDiff = async () => {
      // Use cache if fresh – avoids refetch on tab re-entry.
      const cached = getDiffCached(sessionId);
      if (cached) {
        setDiff(cached.files);
        setTotalAdditions(cached.additions);
        setTotalDeletions(cached.deletions);
        setRawDiffContent(cached.rawContent);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const client = createClient(
          SessionService,
          createConnectTransport({ baseUrl })
        );

        const response = await client.getSessionDiff({ id: sessionId });

        const entry: DiffCacheEntry = {
          files: parseDiff(response.diffStats?.content ?? ""),
          additions: response.diffStats?.added ?? 0,
          deletions: response.diffStats?.removed ?? 0,
          rawContent: response.diffStats?.content ?? "",
          timestamp: Date.now(),
        };
        diffCache.set(sessionId, entry);

        setTotalAdditions(entry.additions);
        setTotalDeletions(entry.deletions);
        setRawDiffContent(entry.rawContent);
        setDiff(entry.files);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load diff");
        console.error("Error fetching diff:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDiff();
  }, [sessionId, baseUrl]);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading diff...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (diff.length === 0 && !loading && !error) {
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
