import { describe, expect, it } from "vitest";

import { proposalStatusCopy } from "./proposal-view";
import type { ProposalHistoryResponse } from "@/lib/cockpit-contracts";

const proposal = {
  id: "proposal-synthetic",
  actionType: "message",
  preview: { type: "unavailable", label: "Unavailable preview" },
  status: "approved",
  expiresAt: "2026-07-18T00:00:00.000Z",
  decidedAt: "2026-07-17T12:00:00.000Z",
  createdAt: "2026-07-17T11:00:00.000Z",
  client: { id: "client-synthetic", name: "Synthetic agent" },
  grant: null,
} satisfies ProposalHistoryResponse["proposals"][number];

describe("proposalStatusCopy", () => {
  it("does not imply approved means sent", () => {
    expect(proposalStatusCopy(proposal)).toBe("Approval granted");
  });

  it("reports execution independently", () => {
    expect(proposalStatusCopy({ ...proposal, grant: { status: "consumed", expiresAt: proposal.expiresAt, consumedAt: proposal.decidedAt, revokedAt: null, outbox: { status: "failed", attempts: 2, completedAt: null, lastErrorCode: "PROVIDER_UNAVAILABLE" } } })).toBe("Approval granted · execution failed");
  });

  it("fails closed for an unavailable persisted envelope", () => {
    expect(proposalStatusCopy({ ...proposal, actionType: "unavailable", status: "unavailable" })).toBe("Unavailable history record");
  });
});
