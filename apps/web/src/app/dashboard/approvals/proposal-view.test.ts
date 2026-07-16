import { describe, expect, it } from "vitest";

import {
  proposalHistoryStatusAfterDecision,
  proposalReceipt,
  proposalStatusCopy,
} from "./proposal-view";
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

  it("does not convert completed execution into approval", () => {
    expect(
      proposalStatusCopy({
        ...proposal,
        grant: {
          status: "consumed",
          expiresAt: proposal.expiresAt,
          consumedAt: proposal.decidedAt,
          revokedAt: null,
          outbox: {
            status: "completed",
            attempts: 1,
            completedAt: proposal.decidedAt,
            lastErrorCode: null,
          },
        },
      })
    ).toBe("Approval granted");
  });

  it("fails closed for an unavailable persisted envelope", () => {
    expect(
      proposalStatusCopy({
        ...proposal,
        actionType: "unavailable",
        status: "unavailable",
      })
    ).toBe("Unavailable history record");
  });
});

describe("proposalReceipt", () => {
  it("does not project a receipt from an unavailable persisted envelope", () => {
    expect(
      proposalReceipt({
        ...proposal,
        actionType: "unavailable",
      })
    ).toBeNull();
  });

  it("makes a rejected proposal's non-effects explicit", () => {
    expect(
      proposalReceipt({ ...proposal, status: "rejected", grant: null })
    ).toEqual({
      decision: "Rejected",
      execution: "Nothing sent",
      progress: "No XP or quest progress awarded",
    });
  });

  it("does not imply an approved proposal requested execution", () => {
    expect(proposalReceipt(proposal)).toEqual({
      decision: "Approval granted",
      execution: "Execution not requested",
      progress: "XP or quest progress not reported",
    });
  });

  it.each([
    ["queued", "Execution queued"],
    ["running", "Execution running"],
    ["completed", "Execution completed"],
    ["failed", "Execution failed"],
  ])("reports %s execution separately from approval", (status, execution) => {
    const receipt = proposalReceipt({
      ...proposal,
      grant: {
        status: "consumed",
        expiresAt: proposal.expiresAt,
        consumedAt: proposal.decidedAt,
        revokedAt: null,
        outbox: {
          status,
          attempts: status === "failed" ? 2 : 1,
          completedAt: status === "completed" ? proposal.decidedAt : null,
          lastErrorCode: status === "failed" ? "PRIVATE_PROVIDER_DETAIL" : null,
        },
      },
    });

    expect(receipt).toEqual({
      decision: "Approval granted",
      execution,
      progress: "XP or quest progress not reported",
    });
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE_PROVIDER_DETAIL");
  });
});

describe("proposalHistoryStatusAfterDecision", () => {
  it.each([
    ["approve", "approved"],
    ["reject", "rejected"],
  ] as const)(
    "switches a pending %s decision to its durable history filter",
    (decision, expectedStatus) => {
      expect(proposalHistoryStatusAfterDecision("pending", decision)).toBe(
        expectedStatus
      );
    }
  );

  it("retains a filter that already includes the decided proposal", () => {
    expect(proposalHistoryStatusAfterDecision("all", "approve")).toBe("all");
  });
});
