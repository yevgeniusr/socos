import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET, PATCH, POST } from "./route";

const params = { params: Promise.resolve({ catchall: ["synthetic"] }) };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API catchall proxy bodyless responses", () => {
  it.each([
    ["GET", 304, GET],
    ["POST", 205, POST],
    ["PATCH", 204, PATCH],
  ] as const)(
    "returns a null body for an upstream %s %s response",
    async (method, status, handler) => {
      const upstreamFetch = vi.fn().mockResolvedValue(
        new Response(null, {
          status,
          headers: { "content-type": "application/json" },
        })
      );
      vi.stubGlobal("fetch", upstreamFetch);
      const request = new NextRequest("http://localhost/api/synthetic", {
        method,
        ...(method === "GET" ? {} : { body: "{}" }),
      });

      const response = await handler(request, params);

      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
      expect(await response.text()).toBe("");
    }
  );
});

describe("API catchall proxy request forwarding", () => {
  it("preserves a manual OAuth redirect and only safe response headers", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 303,
        headers: {
          location: "https://accounts.example.test/oauth/authorize",
          "cache-control": "no-store, private",
          "set-cookie": "upstream_session=secret; HttpOnly; Secure",
        },
      })
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await GET(
      new NextRequest("http://localhost/api/synthetic-oauth"),
      params
    );

    expect(response.status).toBe(303);
    expect(response.body).toBeNull();
    expect(response.headers.get("location")).toBe(
      "https://accounts.example.test/oauth/authorize"
    );
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(upstreamFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/synthetic",
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("forwards a DELETE body, query, and safe headers", async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ removed: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", upstreamFetch);
    const request = new NextRequest(
      "http://localhost/api/synthetic?scope=owner",
      {
        method: "DELETE",
        headers: {
          authorization: "Bearer synthetic-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ confirmation: "synthetic" }),
      }
    );

    const response = await DELETE(request, params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ removed: true });
    expect(upstreamFetch).toHaveBeenCalledOnce();
    const [url, init] = upstreamFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/api/synthetic?scope=owner");
    expect(init).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({ confirmation: "synthetic" }),
      credentials: "include",
    });
    expect(init.headers).toMatchObject({
      authorization: "Bearer synthetic-token",
      "content-type": "application/json",
    });
  });
});
