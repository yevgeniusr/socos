import { BadRequestException, RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { AuthGuard } from "../auth/auth.guard.js";
import { PersonalContextController } from "./personal-context.controller.js";

describe("PersonalContextController", () => {
  function harness() {
    const deletion = {
      deletePersonalContext: jest.fn().mockResolvedValue({
        deletedAt: new Date("2026-07-16T12:00:00.000Z"),
        categories: ["calendar", "location", "event"],
        rowCounts: { calendar: 1, location: 2, event: 3 },
      }),
    };
    return {
      controller: new PersonalContextController(deletion as never),
      deletion,
    };
  }

  it("is a class-guarded static root DELETE controller", () => {
    expect(Reflect.getMetadata(PATH_METADATA, PersonalContextController)).toBe(
      "personal-context"
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PersonalContextController)
    ).toContain(AuthGuard);
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        PersonalContextController.prototype.deletePersonalContext
      )
    ).toBe(RequestMethod.DELETE);
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        PersonalContextController.prototype.deletePersonalContext
      )
    ).toBe("/");
  });

  it("uses only the authenticated JWT owner and forwards the raw idempotency key", async () => {
    const { controller, deletion } = harness();
    const body = { confirmation: "DELETE_PERSONAL_CONTEXT" };

    const result = await controller.deletePersonalContext(
      { user: { userId: "jwt-owner" } },
      "Key_1234:abcd",
      body
    );

    expect(deletion.deletePersonalContext).toHaveBeenCalledWith(
      "jwt-owner",
      "Key_1234:abcd",
      body
    );
    expect(JSON.stringify(result)).not.toMatch(
      /audit|owner|mac|stopp|deletedIds|jwt-owner/i
    );
  });

  it.each([undefined, "", "short", " validKey1", "validKey1 ", "key with spaces"])(
    "rejects invalid untrimmed idempotency key %p",
    async (idempotencyKey) => {
      const { controller, deletion } = harness();

      await expect(
        controller.deletePersonalContext(
          { user: { userId: "owner" } },
          idempotencyKey as never,
          { confirmation: "DELETE_PERSONAL_CONTEXT" }
        )
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(deletion.deletePersonalContext).not.toHaveBeenCalled();
    }
  );

  it.each([
    undefined,
    null,
    {},
    { confirmation: "delete_personal_context" },
    { confirmation: "DELETE_PERSONAL_CONTEXT", ownerId: "caller-owner" },
    { confirmation: "DELETE_PERSONAL_CONTEXT", extra: true },
  ])("rejects non-exact confirmation body %p", async (body) => {
    const { controller, deletion } = harness();

    await expect(
      controller.deletePersonalContext(
        { user: { userId: "owner" } },
        "Valid-Key:123",
        body
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deletion.deletePersonalContext).not.toHaveBeenCalled();
  });
});
