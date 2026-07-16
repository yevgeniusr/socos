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
    pending: "Execution queued",
    processing: "Execution running",
    completed: "Execution completed",
    failed: "Execution failed",
    cancelled: "Execution cancelled",
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

export function proposalAfterDecision(
  proposal: Proposal,
  decision: "approve" | "reject"
): Proposal {
  return {
    ...proposal,
    status: decision === "approve" ? "approved" : "rejected",
    grant: null,
  };
}

function proposalMatchesStatus(
  proposal: Proposal,
  status: ProposalHistoryStatus
): boolean {
  return status === "all" || proposal.status === status;
}

export function proposalsWithPinnedReceipt(
  proposals: Proposal[],
  pinnedProposal: Proposal | null,
  status: ProposalHistoryStatus
): Proposal[] {
  const visible = proposals.filter((proposal) =>
    proposalMatchesStatus(proposal, status)
  );
  if (
    !pinnedProposal ||
    !proposalMatchesStatus(pinnedProposal, status)
  ) {
    return visible;
  }

  const durableProposal = visible.find(
    (proposal) =>
      proposal.id === pinnedProposal.id &&
      proposal.status === pinnedProposal.status
  );
  if (durableProposal) return visible;

  return [
    pinnedProposal,
    ...visible.filter((proposal) => proposal.id !== pinnedProposal.id),
  ];
}
