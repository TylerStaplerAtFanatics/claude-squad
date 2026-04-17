"use client";

import { useApprovalsContext } from "@/lib/contexts/ApprovalsContext";
import { badge, inline as inlineClass } from "./ApprovalNavBadge.css";

interface ApprovalNavBadgeProps {
  inline?: boolean;
}

/**
 * Navigation badge that displays the count of pending tool-use approvals.
 * Used in the header navigation to indicate approvals awaiting user decision.
 *
 * Hidden when there are no pending approvals.
 */
export function ApprovalNavBadge({ inline = false }: ApprovalNavBadgeProps) {
  const { approvals } = useApprovalsContext();

  const count = approvals.length;

  if (count === 0) {
    return null;
  }

  const className = inline
    ? `${badge} ${inlineClass}`
    : badge;

  return (
    <span
      className={className}
      data-testid="approval-nav-badge"
      aria-label={`${count} pending approval${count !== 1 ? "s" : ""}`}
      title={`${count} tool-use request${count !== 1 ? "s" : ""} awaiting approval`}
    >
      {count}
    </span>
  );
}
