import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import {
  EventCatalogController,
  EventPreferencesController,
  EventSourcesController,
} from "./events.controller.js";

describe("events controllers", () => {
  const request = { user: { userId: "jwt-owner" } };

  it("derives every source owner only from the authenticated request", async () => {
    const sources = {
      create: jest.fn().mockResolvedValue({}),
      list: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new EventSourcesController(sources as never);
    const create = {
      name: "Public events",
      feedUrl: "https://events.example.com/feed.ics",
    };
    const patch = { status: "disabled" as const };

    await controller.create(request, create);
    await controller.list(request);
    await controller.update(request, "source-1", patch);
    await controller.remove(request, "source-1");

    expect(sources.create).toHaveBeenCalledWith("jwt-owner", create);
    expect(sources.list).toHaveBeenCalledWith("jwt-owner");
    expect(sources.update).toHaveBeenCalledWith("jwt-owner", "source-1", patch);
    expect(sources.remove).toHaveBeenCalledWith("jwt-owner", "source-1");
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        EventSourcesController.prototype.remove
      )
    ).toBe(HttpStatus.NO_CONTENT);
  });

  it("owner-scopes preference reads, writes, and deletion", async () => {
    const preferences = {
      get: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new EventPreferencesController(preferences as never);
    const input = { interestTags: ["learning"] };

    await controller.get(request);
    await controller.upsert(request, input);
    await controller.remove(request);

    expect(preferences.get).toHaveBeenCalledWith("jwt-owner");
    expect(preferences.upsert).toHaveBeenCalledWith("jwt-owner", input);
    expect(preferences.remove).toHaveBeenCalledWith("jwt-owner");
  });

  it("derives catalog follow state only from the authenticated request", async () => {
    const catalog = {
      search: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      getBySlug: jest.fn().mockResolvedValue({}),
    };
    const controller = new EventCatalogController(catalog as never);
    const query = { q: "holidays", limit: 10 };

    await controller.search(request, query);
    await controller.getBySlug(request, "uae-public-holidays");

    expect(catalog.search).toHaveBeenCalledWith("jwt-owner", query);
    expect(catalog.getBySlug).toHaveBeenCalledWith(
      "jwt-owner",
      "uae-public-holidays"
    );
  });
});
