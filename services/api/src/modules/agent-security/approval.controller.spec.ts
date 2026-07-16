import { RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { AuthGuard } from "../auth/auth.guard.js";
import type { ActionProposalService } from "./action-proposal.service.js";
import { ApprovalController } from "./approval.controller.js";

const request = { user: { userId: "owner-authenticated" } };

describe("ApprovalController", () => {
  it("exposes only human-JWT approval routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ApprovalController)).toBe(
      "agent-proposals"
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, ApprovalController)).toContain(
      AuthGuard
    );
    const routes = Object.getOwnPropertyNames(ApprovalController.prototype)
      .flatMap((name) => {
        const handler = ApprovalController.prototype[name];
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        const path = Reflect.getMetadata(PATH_METADATA, handler);
        return method === undefined || path === undefined
          ? []
          : [`${RequestMethod[method]} ${path}`];
      })
      .sort();
    expect(routes).toEqual([
      "GET /",
      "POST :proposalId/approve",
      "POST :proposalId/reject",
    ]);
  });

  it("uses only the JWT owner for list, approve, and reject", async () => {
    const service = {
      listPending: jest.fn().mockResolvedValue([]),
      approve: jest.fn().mockResolvedValue({ id: "grant-synthetic" }),
      reject: jest.fn().mockResolvedValue({
        id: "proposal-synthetic",
        status: "rejected",
      }),
    };
    const controller = new ApprovalController(
      service as unknown as ActionProposalService
    );

    await expect(controller.list(request)).resolves.toEqual([]);
    await expect(
      controller.approve(request, "proposal-synthetic")
    ).resolves.toEqual({ id: "grant-synthetic" });
    await expect(
      controller.reject(request, "proposal-synthetic")
    ).resolves.toEqual({ id: "proposal-synthetic", status: "rejected" });

    expect(service.listPending).toHaveBeenCalledWith(request.user.userId);
    expect(service.approve).toHaveBeenCalledWith(
      request.user.userId,
      "proposal-synthetic"
    );
    expect(service.reject).toHaveBeenCalledWith(
      request.user.userId,
      "proposal-synthetic"
    );
  });
});
