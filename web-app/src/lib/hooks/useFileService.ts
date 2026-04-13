"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { SessionService } from "@/gen/session/v1/session_pb";
import type { ListFilesResponse, GetFileContentResponse } from "@/gen/session/v1/session_pb";
import type { FileNode } from "@/gen/session/v1/types_pb";

export type { FileNode, ListFilesResponse, GetFileContentResponse };

interface UseGetFileContentResult {
  data: GetFileContentResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * createFileClient creates a ConnectRPC client for the SessionService.
 * Extracted as a helper so both hooks share the same pattern.
 */
function createFileClient(baseUrl: string) {
  return createClient(SessionService, createConnectTransport({ baseUrl }));
}

/**
 * fetchDirectoryFiles is a standalone async function for listing files.
 * Components can call this directly or via the hook.
 */
export async function fetchDirectoryFiles(
  sessionId: string,
  path: string,
  includeIgnored: boolean,
  baseUrl: string
): Promise<ListFilesResponse> {
  const client = createFileClient(baseUrl);
  return await client.listFiles({
    sessionId,
    path: path || ".",
    includeIgnored,
  });
}

/**
 * fetchFileContent is a standalone async function for fetching file content.
 */
export async function fetchFileContent(
  sessionId: string,
  path: string,
  baseUrl: string
): Promise<GetFileContentResponse> {
  const client = createFileClient(baseUrl);
  return await client.getFileContent({ sessionId, path });
}

/**
 * useGetFileContent fetches the content of a file whenever filePath changes.
 * Returns null data while loading or if filePath is null.
 */
export function useGetFileContent(
  sessionId: string,
  filePath: string | null,
  baseUrl: string
): UseGetFileContentResult {
  const [data, setData] = useState<GetFileContentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track which path we're fetching to avoid stale updates.
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!sessionId || !filePath) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setData(null);

    fetchFileContent(sessionId, filePath, baseUrl)
      .then((response) => {
        if (requestId === requestIdRef.current) {
          setData(response);
        }
      })
      .catch((err) => {
        if (requestId === requestIdRef.current) {
          setError(err instanceof Error ? err.message : "Failed to load file content");
          console.error("Error fetching file content:", err);
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      });
  }, [sessionId, filePath, baseUrl]);

  return { data, loading, error };
}
