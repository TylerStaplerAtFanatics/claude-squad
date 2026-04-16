"use client";

import { useState, useEffect } from "react";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { SessionService } from "@/gen/session/v1/session_pb";
import type { WorktreeEntry } from "@/gen/session/v1/session_pb";
import { getApiBaseUrl } from "@/lib/config";

interface UseWorktreeSuggestionsOptions {
  baseUrl?: string;
  enabled?: boolean;
}

/**
 * Fetches git worktrees for the given repository path.
 * Used to populate the "Use Existing Worktree" dropdown in the Omnibar.
 */
export function useWorktreeSuggestions(
  repoPath: string,
  options: UseWorktreeSuggestionsOptions = {}
) {
  const { baseUrl = getApiBaseUrl(), enabled = true } = options;
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !repoPath.trim()) {
      setWorktrees([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const transport = createConnectTransport({ baseUrl });
    const client = createClient(SessionService, transport);

    client
      .listWorktrees({ repoPath })
      .then((response) => {
        if (!cancelled) {
          setWorktrees(response.worktrees || []);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch worktrees");
          setWorktrees([]);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, baseUrl, enabled]);

  return { worktrees, isLoading, error };
}
