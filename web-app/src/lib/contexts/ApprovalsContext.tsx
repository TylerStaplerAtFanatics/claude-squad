"use client";

import { createContext, useContext, ReactNode, useCallback } from "react";
import { useGetApprovalsQuery, useResolveApprovalMutation } from "@/lib/api/approvalsApi";
import type { PlainApproval } from "@/lib/api/approvalsApi";

interface ApprovalsContextValue {
  approvals: PlainApproval[];
  loading: boolean;
  error: Error | null;
  approve: (approvalId: string) => Promise<void>;
  deny: (approvalId: string, message?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const ApprovalsContext = createContext<ApprovalsContextValue | null>(null);

export function ApprovalsProvider({ children }: { children: ReactNode }) {
  // RTK Query with 5s polling (approvals are blocking actions)
  const { data, isLoading, error: queryError, refetch } = useGetApprovalsQuery(undefined, {
    pollingInterval: 5000,
  });

  const [resolveApproval] = useResolveApprovalMutation();

  const approve = useCallback(async (approvalId: string) => {
    await resolveApproval({ approvalId, decision: "allow" });
  }, [resolveApproval]);

  const deny = useCallback(async (approvalId: string, message?: string) => {
    await resolveApproval({ approvalId, decision: "deny", message });
  }, [resolveApproval]);

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const approvals = data?.approvals ?? [];
  const error = queryError
    ? new Error(
        typeof queryError === "object" && "error" in queryError
          ? String((queryError as { error: unknown }).error)
          : "Unknown error"
      )
    : null;

  return (
    <ApprovalsContext.Provider
      value={{
        approvals,
        loading: isLoading,
        error,
        approve,
        deny,
        refresh,
      }}
    >
      {children}
    </ApprovalsContext.Provider>
  );
}

export function useApprovalsContext() {
  const ctx = useContext(ApprovalsContext);
  if (!ctx) throw new Error("useApprovalsContext must be used within ApprovalsProvider");
  return ctx;
}
