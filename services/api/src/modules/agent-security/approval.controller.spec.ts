import { RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { createApplicationValidationPipe } from "../../common/application-validation.pipe.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { ApprovalHistoryQueryDto } from "./action-proposal.dto.js";
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
      "GET history",
      "POST :proposalId/approve",
      "POST :proposalId/reject",
    ]);
  });

  it("validates and transforms bounded history query parameters", async () => {
    const pipe = createApplicationValidationPipe();

    for (const status of [
      "all",
      "pending",
      "approved",
      "rejected",
      "expired",
    ]) {
      await expect(
        pipe.transform(
          { status, limit: "50", offset: "10" },
          { type: "query", metatype: ApprovalHistoryQueryDto }
        )
      ).resolves.toEqual({ status, limit: 50, offset: 10 });
    }
    await expect(
      pipe.transform({}, { type: "query", metatype: ApprovalHistoryQueryDto })
    ).resolves.toEqual({ status: "all", limit: 20, offset: 0 });
  });

  it.each([
    { status: "unknown" },
    { limit: "0" },
    { limit: "51" },
    { limit: "1.5" },
    { offset: "-1" },
    { offset: "1.5" },
  ])("rejects invalid history query %#", async (query) => {
    await expect(
      createApplicationValidationPipe().transform(query, {
        type: "query",
        metatype: ApprovalHistoryQueryDto,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("uses only the JWT owner for list, history, approve, and reject", async () => {
    const service = {
      listPending: jest.fn().mockResolvedValue([]),
      listHistory: jest.fn().mockResolvedValue({
        proposals: [],
        total: 0,
        offset: 0,
        limit: 20,
      }),
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
      controller.history(request, { status: "all", limit: 20, offset: 0 })
    ).resolves.toEqual({ proposals: [], total: 0, offset: 0, limit: 20 });
    await expect(
      controller.approve(request, "proposal-synthetic")
    ).resolves.toEqual({ id: "grant-synthetic" });
    await expect(
      controller.reject(request, "proposal-synthetic")
    ).resolves.toEqual({ id: "proposal-synthetic", status: "rejected" });

    expect(service.listPending).toHaveBeenCalledWith(request.user.userId);
    expect(service.listHistory).toHaveBeenCalledWith(request.user.userId, {
      status: "all",
      limit: 20,
      offset: 0,
    });
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
