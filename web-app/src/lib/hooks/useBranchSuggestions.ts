"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { SessionService } from "@/gen/session/v1/session_pb";
import { getApiBaseUrl } from "@/lib/config";

interface BranchSuggestionsOptions {
  repositoryPath?: string;
  baseUrl?: string;
}

/**
 * Hook to provide git branch suggestions from the real git refs of the selected repo.
 * Calls ListBranches RPC when repositoryPath changes. Cancels in-flight requests on path change.
 * Returns { suggestions, isLoading } — same interface as the previous implementation.
 */
export function useBranchSuggestions(options: BranchSuggestionsOptions = {}) {
  const { repositoryPath, baseUrl = getApiBaseUrl() } = options;
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Cancel any in-flight request from a previous repositoryPath.
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (!repositoryPath) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Create transport and client once per effect invocation (not per retry).
    const transport = createConnectTransport({ baseUrl });
    const client = createClient(SessionService, transport);

    const fetchBranches = async () => {
      setIsLoading(true);
      setSuggestions([]);

      try {
        const response = await client.listBranches(
          { repoPath: repositoryPath },
          { signal: controller.signal }
        );

        if (!controller.signal.aborted) {
          setSuggestions(response.branches ?? []);
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          return; // Request was cancelled — ignore
        }
        console.error("Failed to fetch branch suggestions:", error);
        setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchBranches();

    return () => {
      controller.abort();
    };
  }, [repositoryPath, baseUrl]);

  return { suggestions, isLoading };
}
