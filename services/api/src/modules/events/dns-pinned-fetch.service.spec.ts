import {
  DnsPinnedFetchService,
  isPublicInternetAddress,
} from "./dns-pinned-fetch.service.js";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";

describe("public Internet address classification", () => {
  it.each([
    ["8.8.8.8", 4],
    ["1.1.1.1", 4],
    ["2606:4700:4700::1111", 6],
    ["2001:4860:4860::8888", 6],
  ] as const)("accepts %s", (address, family) => {
    expect(isPublicInternetAddress(address, family)).toBe(true);
  });

  it.each([
    ["0.0.0.0", 4],
    ["10.0.0.1", 4],
    ["100.64.0.1", 4],
    ["127.0.0.1", 4],
    ["169.254.169.254", 4],
    ["172.16.0.1", 4],
    ["192.0.0.1", 4],
    ["192.0.2.1", 4],
    ["192.31.196.1", 4],
    ["192.52.193.1", 4],
    ["192.175.48.1", 4],
    ["192.168.1.1", 4],
    ["198.18.0.1", 4],
    ["198.51.100.1", 4],
    ["203.0.113.1", 4],
    ["224.0.0.1", 4],
    ["240.0.0.1", 4],
    ["255.255.255.255", 4],
    ["::", 6],
    ["::1", 6],
    ["::ffff:8.8.8.8", 6],
    ["64:ff9b::808:808", 6],
    ["100::1", 6],
    ["2001:db8::1", 6],
    ["2001:10::1", 6],
    ["2001:1::1", 6],
    ["2002:0808:0808::1", 6],
    ["3fff::1", 6],
    ["fc00::1", 6],
    ["fec0::1", 6],
    ["fe80::1", 6],
    ["ff02::1", 6],
    ["fe80::1%eth0", 6],
  ] as const)("rejects %s", (address, family) => {
    expect(isPublicInternetAddress(address, family)).toBe(false);
  });
});

describe("DnsPinnedFetchService", () => {
  it("rejects the entire DNS answer set when any result is unsafe", async () => {
    const lookup = jest.fn((_host, _options, callback) =>
      callback(null, [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ])
    );
    const request = jest.fn();
    const service = new DnsPinnedFetchService({ lookup, request } as never);

    await expect(
      service.fetchText(new URL("https://events.example.com/feed.ics"))
    ).rejects.toThrow("Event feed request failed");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("pins the resolved bytes while retaining Host, SNI, and certificate checks", async () => {
    let captured: any;
    const response = syntheticResponse(200, {}, Buffer.from("BEGIN:VCALENDAR"));
    const request = jest.fn((options, callback) => {
      captured = options;
      return syntheticRequest(() => callback(response));
    });
    const lookup = jest.fn((_host, _options, callback) =>
      callback(null, [
        { address: "8.8.8.8", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ])
    );
    const service = new DnsPinnedFetchService({ lookup, request } as never);

    await expect(
      service.fetchText(new URL("https://events.example.com/feed.ics?q=1"))
    ).resolves.toBe("BEGIN:VCALENDAR");

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(captured.hostname).toBe("events.example.com");
    expect(captured.path).toBe("/feed.ics?q=1");
    expect(captured.servername).toBe("events.example.com");
    expect(captured.rejectUnauthorized).toBe(true);
    expect(captured.agent).toBe(false);
    expect(captured.autoSelectFamily).toBe(false);
    expect(captured.headers.Host).toBe("events.example.com");

    const scalar = jest.fn();
    captured.lookup("events.example.com", { family: 4, all: false }, scalar);
    expect(scalar).toHaveBeenCalledWith(null, "8.8.8.8", 4);

    const all = jest.fn();
    captured.lookup("events.example.com", { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it.each([301, 302, 307, 308, 404, 500])(
    "rejects HTTP status %s without following it",
    async (statusCode) => {
      const response = syntheticResponse(statusCode, {
        location: "https://other.test",
      });
      const service = serviceForResponse(response);
      await expect(
        service.fetchText(new URL("https://events.example.com/feed.ics"))
      ).rejects.toThrow("Event feed request failed");
      expect(response.destroyed).toBe(true);
    }
  );

  it("enforces the decoded byte limit after gzip decompression", async () => {
    const exact = Buffer.alloc(5 * 1024 * 1024, 0x61);
    await expect(
      serviceForResponse(
        syntheticResponse(200, { "content-encoding": "gzip" }, gzipSync(exact))
      ).fetchText(new URL("https://events.example.com/feed.ics"))
    ).resolves.toHaveLength(exact.length);

    const overflow = syntheticResponse(
      200,
      { "content-encoding": "gzip" },
      gzipSync(Buffer.alloc(exact.length + 1, 0x61))
    );
    await expect(
      serviceForResponse(overflow).fetchText(
        new URL("https://events.example.com/feed.ics")
      )
    ).rejects.toThrow("Event feed request failed");
    expect(overflow.destroyed).toBe(true);
  });

  it("rejects unsupported encodings and malformed UTF-8 with one safe error", async () => {
    for (const response of [
      syntheticResponse(
        200,
        { "content-encoding": "compress" },
        Buffer.from("x")
      ),
      syntheticResponse(200, {}, Buffer.from([0xc3, 0x28])),
    ]) {
      await expect(
        serviceForResponse(response).fetchText(
          new URL("https://events.example.com/feed.ics")
        )
      ).rejects.toThrow("Event feed request failed");
      expect(response.destroyed).toBe(true);
    }
  });

  it("destroys the response for an array-valued content encoding", async () => {
    const response = syntheticResponse(200, {}, Buffer.from("private"));
    response.headers["content-encoding"] = ["gzip", "br"] as never;

    await expect(
      serviceForResponse(response).fetchText(
        new URL("https://events.example.com/feed.ics")
      )
    ).rejects.toThrow("Event feed request failed");
    expect(response.destroyed).toBe(true);
  });

  it("uses one deadline beginning before DNS", async () => {
    jest.useFakeTimers();
    try {
      const service = new DnsPinnedFetchService({
        lookup: jest.fn(),
        request: jest.fn(),
      } as never);
      const pending = service.fetchText(
        new URL("https://events.example.com/feed.ics"),
        Date.now() + 10_000
      );
      const assertion = expect(pending).rejects.toThrow(
        "Event feed request failed"
      );
      await jest.advanceTimersByTimeAsync(10_001);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});

function serviceForResponse(
  response: Readable & { statusCode: number; headers: any }
) {
  return new DnsPinnedFetchService({
    lookup: (_host: string, _options: unknown, callback: Function) =>
      callback(null, [{ address: "8.8.8.8", family: 4 }]),
    request: (_options: unknown, callback: Function) =>
      syntheticRequest(() => callback(response)),
  } as never);
}

function syntheticResponse(
  statusCode: number,
  headers: Record<string, string> = {},
  body: Buffer = Buffer.alloc(0)
) {
  const response = Readable.from([body]) as Readable & {
    statusCode: number;
    headers: Record<string, string>;
  };
  response.statusCode = statusCode;
  response.headers = headers;
  return response;
}

function syntheticRequest(onEnd: () => void) {
  const request = new EventEmitter() as EventEmitter & {
    end: () => void;
    destroy: (error?: Error) => void;
  };
  request.end = onEnd;
  request.destroy = (error?: Error) => {
    if (error) request.emit("error", error);
  };
  return request;
}
