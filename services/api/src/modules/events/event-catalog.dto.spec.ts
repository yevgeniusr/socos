import type { ArgumentMetadata } from "@nestjs/common";
import { createApplicationValidationPipe } from "../../common/application-validation.pipe.js";
import {
  PatchEventCatalogFollowDto,
  PutEventCatalogFollowDto,
} from "./event-catalog.dto.js";

async function transform(metatype: new () => object, value: object) {
  const metadata: ArgumentMetadata = { type: "body", metatype };
  return createApplicationValidationPipe().transform(value, metadata);
}

describe("event catalog follow DTOs", () => {
  it.each([0, 10])("accepts social weight boundary %s", async (socialWeight) => {
    await expect(
      transform(PutEventCatalogFollowDto, { socialWeight })
    ).resolves.toMatchObject({ socialWeight });
  });

  it.each([-1, 11, 1.5, "5", null])(
    "rejects invalid social weight %p",
    async (socialWeight) => {
      await expect(
        transform(PutEventCatalogFollowDto, { socialWeight })
      ).rejects.toBeDefined();
    }
  );

  it.each(["active", "paused"])("accepts PATCH status %s", async (status) => {
    await expect(
      transform(PatchEventCatalogFollowDto, { status })
    ).resolves.toMatchObject({ status });
  });

  it.each([{}, { status: "deleted" }, { status: null }])(
    "rejects invalid PATCH %p",
    async (input) => {
      await expect(transform(PatchEventCatalogFollowDto, input)).rejects.toBeDefined();
    }
  );
});
