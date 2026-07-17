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

export interface DecisionAnnouncement {
  copy: string;
  confirmation: string;
}

export function decisionAnnouncement(
  decision: "approve" | "reject",
  sequence: number
): DecisionAnnouncement {
  return {
    copy:
      decision === "approve"
        ? "Approval recorded. Receipt ready."
        : "Rejection recorded. Receipt ready.",
    confirmation: `Confirmation ${sequence}.`,
  };
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

const executionProgress: Record<string, number> = {
  pending: 1,
  processing: 2,
  completed: 3,
  failed: 3,
  cancelled: 3,
};

const terminalExecutionStatuses = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export function proposalPinWithDurableHistory(
  pinnedProposal: Proposal,
  proposals: Proposal[]
): Proposal {
  const durableProposal = proposals.find(
    (proposal) =>
      proposal.id === pinnedProposal.id &&
      proposal.status === pinnedProposal.status
  );
  if (!durableProposal) return pinnedProposal;

  const pinnedStatus = pinnedProposal.grant?.outbox?.status;
  const durableStatus = durableProposal.grant?.outbox?.status;
  const pinnedProgress = pinnedStatus ? (executionProgress[pinnedStatus] ?? 0) : 0;
  const durableProgress = durableStatus
    ? (executionProgress[durableStatus] ?? 0)
    : 0;
  if (
    durableProgress < pinnedProgress ||
    (pinnedStatus &&
      terminalExecutionStatuses.has(pinnedStatus) &&
      durableStatus !== pinnedStatus)
  ) {
    return pinnedProposal;
  }

  return {
    ...durableProposal,
    preview: pinnedProposal.preview,
  };
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
  if (durableProposal) {
    const updatedPin = proposalPinWithDurableHistory(
      pinnedProposal,
      visible
    );
    return visible.map((proposal) =>
      proposal.id === pinnedProposal.id ? updatedPin : proposal
    );
  }

  return [
    pinnedProposal,
    ...visible.filter((proposal) => proposal.id !== pinnedProposal.id),
  ];
}
