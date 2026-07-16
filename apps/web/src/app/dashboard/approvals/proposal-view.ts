import type {
  ProposalHistoryResponse,
  ProposalHistoryStatus,
} from "@/lib/cockpit-contracts";

type Proposal = ProposalHistoryResponse["proposals"][number];

export interface ProposalReceipt {
  decision: string;
  execution: string;
  progress: string;
}

export function proposalStatusCopy(proposal: Proposal): string {
  if (
    proposal.status === "unavailable" ||
    proposal.actionType === "unavailable"
  ) {
    return "Unavailable history record";
  }
  if (proposal.status === "approved") {
    return "Approval granted";
  }
  if (proposal.status === "pending") return "Awaiting your decision";
  if (proposal.status === "rejected") return "Rejected";
  return "Expired without approval";
}

export function proposalReceipt(proposal: Proposal): ProposalReceipt | null {
  if (
    proposal.status === "unavailable" ||
    proposal.actionType === "unavailable"
  ) {
    return null;
  }

  if (proposal.status === "rejected") {
    return {
      decision: "Rejected",
      execution: "Nothing sent",
      progress: "No XP or quest progress awarded",
    };
  }

  if (proposal.status === "expired") {
    return {
      decision: "Expired without approval",
      execution: "Nothing sent",
      progress: "No XP or quest progress awarded",
    };
  }

  if (proposal.status !== "approved") return null;

  const executionByStatus: Record<string, string> = {
    queued: "Execution queued",
    running: "Execution running",
    completed: "Execution completed",
    failed: "Execution failed",
  };
  const outboxStatus = proposal.grant?.outbox?.status;

  return {
    decision: "Approval granted",
    execution: outboxStatus
      ? (executionByStatus[outboxStatus] ?? "Execution status unavailable")
      : "Execution not requested",
    progress: "XP or quest progress not reported",
  };
}

export function proposalHistoryStatusAfterDecision(
  currentStatus: ProposalHistoryStatus,
  decision: "approve" | "reject"
): ProposalHistoryStatus {
  if (currentStatus !== "pending") return currentStatus;
  return decision === "approve" ? "approved" : "rejected";
}
