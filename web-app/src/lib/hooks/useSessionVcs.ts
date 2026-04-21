"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { SessionService } from "@/gen/session/v1/session_pb";
import { VCSStatus } from "@/gen/session/v1/types_pb";

/** Parsed diff stats returned by getSessionDiff. */
export interface SessionDiff {
  content: string;
  added: number;
  removed: number;
}

export interface SessionVcsState {
  /** VCS status, null while loading or when the directory is not a VCS repo. */
  status: VCSStatus | null;
  /** Diff content, null while loading or when there are no changes. */
  diff: SessionDiff | null;
  statusLoading: boolean;
  diffLoading: boolean;
  /** Error message from VCS status fetch (diff errors are non-fatal). */
  error: string | null;
  /** Trigger a fresh VCS status fetch (shared across all consumers). */
  refreshStatus: () => void;
  /** Trigger a fresh diff fetch (shared across all consumers). */
  refreshDiff: () => void;
  /** Refresh both status and diff. */
  refresh: () => void;
}

/** Poll VCS status every 10 seconds — same cadence as the old VcsPanel used. */
const VCS_POLL_MS = 10_000;

/**
 * Single source of truth for a session's VCS status and diff data.
 *
 * Intended to be instantiated once per SessionDetail via SessionVcsProvider
 * and consumed by VcsPanel, FilesTab, and DiffViewer through
 * useSessionVcsContext(). This eliminates the 3 independent, uncached fetches
 * those components previously made independently.
 */
export function useSessionVcs(sessionId: string, baseUrl: string): SessionVcsState {
  const [status, setStatus] = useState<VCSStatus | null>(null);
  const [diff, setDiff] = useState<SessionDiff | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [diffLoading, setDiffLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable client reference — recreated only when baseUrl changes.
  const clientRef = useRef<ReturnType<typeof createClient<typeof SessionService>> | null>(null);
  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = createClient(SessionService, createConnectTransport({ baseUrl }));
    }
    return clientRef.current;
  }, [baseUrl]);

  // Invalidate client when baseUrl changes.
  useEffect(() => {
    clientRef.current = null;
  }, [baseUrl]);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await getClient().getVCSStatus({ id: sessionId });
      if (response.error) {
        setError(response.error);
        setStatus(null);
      } else {
        setStatus(response.vcsStatus ?? null);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load VCS status");
    } finally {
      setStatusLoading(false);
    }
  }, [sessionId, getClient]);

  const fetchDiff = useCallback(async () => {
    setDiffLoading(true);
    try {
      const response = await getClient().getSessionDiff({ id: sessionId });
      if (response.diffStats) {
        setDiff({
          content: response.diffStats.content,
          added: response.diffStats.added,
          removed: response.diffStats.removed,
        });
      } else {
        setDiff(null);
      }
    } catch (err) {
      // Diff errors are non-fatal — status error is the primary signal.
      console.error("useSessionVcs: failed to load diff:", err);
    } finally {
      setDiffLoading(false);
    }
  }, [sessionId, getClient]);

  const refresh = useCallback(() => {
    fetchStatus();
    fetchDiff();
  }, [fetchStatus, fetchDiff]);

  // VCS status: initial fetch + polling.
  useEffect(() => {
    setStatusLoading(true);
    fetchStatus();
    const interval = setInterval(fetchStatus, VCS_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Diff: fetch once on mount; consumers call refreshDiff() when needed.
  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  return {
    status,
    diff,
    statusLoading,
    diffLoading,
    error,
    refreshStatus: fetchStatus,
    refreshDiff: fetchDiff,
    refresh,
  };
}
