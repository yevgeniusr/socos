import type { ProposalHistoryResponse } from "@/lib/cockpit-contracts";

type Proposal = ProposalHistoryResponse["proposals"][number];

export function proposalStatusCopy(proposal: Proposal): string {
  if (proposal.status === "unavailable" || proposal.actionType === "unavailable") {
    return "Unavailable history record";
  }
  if (proposal.status === "approved") {
    if (!proposal.grant) return "Approval granted";
    if (proposal.grant.outbox?.status === "completed") return "Execution completed";
    if (proposal.grant.outbox) {
      return `Approval granted · execution ${proposal.grant.outbox.status}`;
    }
    return `Approval granted · grant ${proposal.grant.status}`;
  }
  if (proposal.status === "pending") return "Awaiting your decision";
  if (proposal.status === "rejected") return "Rejected";
  return "Expired without approval";
}
