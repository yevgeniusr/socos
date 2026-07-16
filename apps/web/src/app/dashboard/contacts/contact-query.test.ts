import { describe, expect, it } from "vitest";

import { buildContactQuery, getPageWindow } from "./contact-query";

describe("buildContactQuery", () => {
  it("encodes trimmed filters and deterministic pagination options", () => {
    expect(
      buildContactQuery({
        search: " mentor ",
        label: "AI Founders",
        group: "Mentors",
        offset: 25,
        limit: 25,
        sortBy: "lastContactedAt",
        sortOrder: "desc",
      })
    ).toBe(
      "limit=25&offset=25&search=mentor&label=AI+Founders&group=Mentors&sortBy=lastContactedAt&sortOrder=desc"
    );
  });

  it("omits empty filters while retaining list bounds", () => {
    expect(
      buildContactQuery({
        search: "  ",
        label: "",
        tag: " ",
        group: "   ",
        offset: 0,
        limit: 25,
        sortBy: "createdAt",
        sortOrder: "desc",
      })
    ).toBe("limit=25&offset=0&sortBy=createdAt&sortOrder=desc");
  });
});

describe("getPageWindow", () => {
  it("describes the current page and available directions", () => {
    expect(getPageWindow({ total: 106, offset: 25, limit: 25 })).toEqual({
      start: 26,
      end: 50,
      page: 2,
      pageCount: 5,
      hasPrevious: true,
      hasNext: true,
    });
  });

  it("returns a zero window for empty results", () => {
    expect(getPageWindow({ total: 0, offset: 0, limit: 25 })).toEqual({
      start: 0,
      end: 0,
      page: 0,
      pageCount: 0,
      hasPrevious: false,
      hasNext: false,
    });
  });

  it("bounds the final partial page", () => {
    expect(getPageWindow({ total: 106, offset: 100, limit: 25 })).toEqual({
      start: 101,
      end: 106,
      page: 5,
      pageCount: 5,
      hasPrevious: true,
      hasNext: false,
    });
  });

  it("clamps stale offsets to the final available page", () => {
    expect(getPageWindow({ total: 49, offset: 250, limit: 25 })).toEqual({
      start: 26,
      end: 49,
      page: 2,
      pageCount: 2,
      hasPrevious: true,
      hasNext: false,
    });
  });
});
