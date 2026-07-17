import { describe, expect, it } from "vitest";

import {
  decisionAnnouncement,
  proposalAfterDecision,
  proposalHistoryStatusAfterDecision,
  proposalPinWithDurableHistory,
  proposalReceipt,
  proposalsWithPinnedReceipt,
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
    ["pending", "Execution queued"],
    ["processing", "Execution running"],
    ["completed", "Execution completed"],
    ["failed", "Execution failed"],
    ["cancelled", "Execution cancelled"],
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

describe("proposalAfterDecision", () => {
  it.each([
    ["approve", "approved"],
    ["reject", "rejected"],
  ] as const)(
    "retains the exact reviewed preview after %s",
    (decision, expectedStatus) => {
      const pending = {
        ...proposal,
        status: "pending" as const,
        decidedAt: null,
      };

      const decided = proposalAfterDecision(pending, decision);

      expect(decided).toEqual({
        ...pending,
        status: expectedStatus,
        grant: null,
      });
      expect(decided.preview).toBe(pending.preview);
    }
  );
});

describe("proposalsWithPinnedReceipt", () => {
  const pinned = {
    ...proposal,
    id: "proposal-pinned",
    preview: {
      type: "message" as const,
      contact: { id: "contact-pinned", name: "Pinned Person" },
      channel: "social",
      body: "Exact pinned preview",
    },
  };

  it("keeps a just-decided proposal ahead of a full first page that omits it", () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      ...proposal,
      id: `proposal-${index}`,
    }));

    const visible = proposalsWithPinnedReceipt(firstPage, pinned, "approved");

    expect(visible).toHaveLength(21);
    expect(visible[0]).toBe(pinned);
    expect(visible[0].preview).toBe(pinned.preview);
  });

  it("retains durable execution state and the exact preview through omission", () => {
    const durable = {
      ...pinned,
      preview: {
        ...pinned.preview,
        body: "Changed durable preview",
      },
      grant: {
        status: "consumed",
        expiresAt: pinned.expiresAt,
        consumedAt: pinned.decidedAt,
        revokedAt: null,
        outbox: {
          status: "processing",
          attempts: 1,
          completedAt: null,
          lastErrorCode: null,
        },
      },
    };

    const updatedPin = proposalPinWithDurableHistory(pinned, [durable]);

    expect(updatedPin.preview).toBe(pinned.preview);
    expect(proposalReceipt(updatedPin)?.execution).toBe("Execution running");
    expect(proposalsWithPinnedReceipt([durable], pinned, "approved")).toEqual([
      updatedPin,
    ]);
    expect(proposalsWithPinnedReceipt([], updatedPin, "approved")).toEqual([
      updatedPin,
    ]);
    expect(
      proposalReceipt(
        proposalsWithPinnedReceipt([], updatedPin, "approved")[0]
      )?.execution
    ).toBe("Execution running");
  });

  it("does not regress a terminal pin when history later returns an older state", () => {
    const completed = {
      ...pinned,
      grant: {
        status: "consumed",
        expiresAt: pinned.expiresAt,
        consumedAt: pinned.decidedAt,
        revokedAt: null,
        outbox: {
          status: "completed",
          attempts: 2,
          completedAt: pinned.decidedAt,
          lastErrorCode: null,
        },
      },
    };
    const processing = {
      ...completed,
      grant: {
        ...completed.grant,
        outbox: {
          ...completed.grant.outbox,
          status: "processing",
          completedAt: null,
        },
      },
    };

    const updatedPin = proposalPinWithDurableHistory(pinned, [completed]);
    const afterStaleHistory = proposalPinWithDurableHistory(updatedPin, [
      processing,
    ]);

    expect(proposalReceipt(afterStaleHistory)?.execution).toBe(
      "Execution completed"
    );
  });

  it("replaces a stale pending copy and hides the pin from other filters", () => {
    const stalePending = { ...pinned, status: "pending" as const };

    expect(
      proposalsWithPinnedReceipt([stalePending], pinned, "approved")
    ).toEqual([pinned]);
    expect(proposalsWithPinnedReceipt([], pinned, "rejected")).toEqual([]);
  });
});

describe("decisionAnnouncement", () => {
  it("gives repeated decisions fresh accessible text and concise visible copy", () => {
    const first = decisionAnnouncement("approve", 1);
    const second = decisionAnnouncement("approve", 2);

    expect(first.copy).toBe("Approval recorded. Receipt ready.");
    expect(second.copy).toBe(first.copy);
    expect(second.confirmation).not.toBe(first.confirmation);
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
