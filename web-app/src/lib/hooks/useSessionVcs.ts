"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { SessionService } from "@/gen/session/v1/session_pb";
import { VCSStatus } from "@/gen/session/v1/types_pb";
import { useAppSelector } from "@/lib/store";
import { selectAllSessions } from "@/lib/store/sessionsSlice";

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

  // Watch session state from the Redux store so VCS data re-fetches whenever
  // the session is updated by the server-pushed watchSessions stream, instead
  // of polling on a fixed interval.
  const sessionStatus = useAppSelector((state) =>
    selectAllSessions(state).find((s) => s.id === sessionId)?.status
  );
  const sessionUpdatedAt = useAppSelector((state) => {
    const s = selectAllSessions(state).find((s) => s.id === sessionId);
    return s?.updatedAt?.seconds ?? null;
  });

  // VCS status: re-fetch on mount and whenever the session changes in Redux.
  // Event-driven is the primary trigger; the 60s fallback catches git commits
  // that happen mid-session without changing the session's status field.
  useEffect(() => {
    setStatusLoading(true);
    fetchStatus();
    const fallback = setInterval(() => {
      if (!document.hidden) fetchStatus();
    }, 60_000);
    return () => clearInterval(fallback);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchStatus, sessionStatus, sessionUpdatedAt]);

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
