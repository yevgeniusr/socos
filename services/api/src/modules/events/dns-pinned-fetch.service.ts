import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { Inject, Injectable, Optional } from "@nestjs/common";

const DEADLINE_MS = 10_000;
const MAX_DECODED_BYTES = 5 * 1024 * 1024;
const SAFE_ERROR = "Event feed request failed";

type LookupAnswer = { address: string; family: 4 | 6 };
type Lookup = (
  hostname: string,
  options: { all: true; order: "verbatim" },
  callback: (
    error: NodeJS.ErrnoException | null,
    addresses: LookupAnswer[]
  ) => void
) => void;
type RequestFactory = typeof httpsRequest;

export type DnsPinnedFetchDependencies = {
  lookup: Lookup;
  request: RequestFactory;
};

export const DNS_PINNED_FETCH_DEPENDENCIES = Symbol(
  "DNS_PINNED_FETCH_DEPENDENCIES"
);

@Injectable()
export class DnsPinnedFetchService {
  private readonly dependencies: DnsPinnedFetchDependencies;

  constructor(
    @Optional()
    @Inject(DNS_PINNED_FETCH_DEPENDENCIES)
    dependencies?: DnsPinnedFetchDependencies
  ) {
    this.dependencies = dependencies ?? {
      lookup: dnsLookup as Lookup,
      request: httpsRequest,
    };
  }

  async fetchText(
    url: URL,
    deadlineAt = Date.now() + DEADLINE_MS
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(0, deadlineAt - Date.now())
    );
    timer.unref?.();
    try {
      const answers = await this.resolve(url.hostname, controller.signal);
      return await this.request(url, answers, controller.signal);
    } catch {
      throw new Error(SAFE_ERROR);
    } finally {
      clearTimeout(timer);
    }
  }

  private resolve(
    hostname: string,
    signal: AbortSignal
  ): Promise<LookupAnswer[]> {
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error(SAFE_ERROR));
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      this.dependencies.lookup(
        hostname,
        { all: true, order: "verbatim" },
        (error, answers) => {
          signal.removeEventListener("abort", abort);
          if (
            error ||
            answers.length === 0 ||
            answers.some(
              ({ address, family }) => !isPublicInternetAddress(address, family)
            )
          ) {
            reject(new Error(SAFE_ERROR));
            return;
          }
          resolve(answers.map((answer) => ({ ...answer })));
        }
      );
    });
  }

  private request(
    url: URL,
    answers: readonly LookupAnswer[],
    signal: AbortSignal
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(new Error(SAFE_ERROR));
      };
      const options: RequestOptions & { autoSelectFamily: boolean } = {
        protocol: "https:",
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Accept: "text/calendar",
          "Accept-Encoding": "identity, gzip, deflate, br",
          Host: url.hostname,
        },
        agent: false,
        autoSelectFamily: false,
        servername: url.hostname,
        rejectUnauthorized: true,
        signal,
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options.all === true) {
            (
              callback as unknown as (
                error: null,
                addresses: LookupAnswer[]
              ) => void
            )(
              null,
              answers.map((answer) => ({ ...answer }))
            );
            return;
          }
          const requestedFamily =
            typeof options === "object" && typeof options.family === "number"
              ? options.family
              : 0;
          const selected =
            requestedFamily === 0
              ? answers[0]
              : answers.find((answer) => answer.family === requestedFamily);
          if (!selected) {
            const error = new Error(SAFE_ERROR) as NodeJS.ErrnoException;
            error.code = "EAI_ADDRFAMILY";
            callback(error, "", requestedFamily);
            return;
          }
          callback(null, selected.address, selected.family);
        },
      };
      const request = this.dependencies.request(options, (response) => {
        void this.consumeResponse(response, signal).then((value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        }, fail);
      });
      request.once("error", fail);
      signal.addEventListener(
        "abort",
        () => {
          request.destroy(new Error(SAFE_ERROR));
          fail();
        },
        { once: true }
      );
      request.end();
    });
  }

  private async consumeResponse(
    response: IncomingMessage,
    signal: AbortSignal
  ): Promise<string> {
    if (response.statusCode !== 200) {
      response.destroy();
      throw new Error(SAFE_ERROR);
    }
    const encodingHeader = response.headers["content-encoding"];
    if (Array.isArray(encodingHeader)) {
      response.destroy();
      throw new Error(SAFE_ERROR);
    }
    const encoding = (encodingHeader ?? "identity").trim().toLowerCase();
    const decoded =
      encoding === "identity"
        ? response
        : encoding === "gzip"
          ? response.pipe(createGunzip())
          : encoding === "deflate"
            ? response.pipe(createInflate())
            : encoding === "br"
              ? response.pipe(createBrotliDecompress())
              : undefined;
    if (!decoded) {
      response.destroy();
      throw new Error(SAFE_ERROR);
    }

    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of decoded) {
        if (signal.aborted) throw new Error(SAFE_ERROR);
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_DECODED_BYTES) {
          decoded.destroy();
          response.destroy();
          throw new Error(SAFE_ERROR);
        }
        chunks.push(bytes);
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks)
      );
    } catch {
      decoded.destroy();
      response.destroy();
      throw new Error(SAFE_ERROR);
    }
  }
}

export function isPublicInternetAddress(
  address: string,
  family: number
): boolean {
  if (address.includes("%") || isIP(address) !== family) return false;
  if (family === 4) {
    const bytes = address.split(".").map(Number);
    const value =
      ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    return !IPV4_FORBIDDEN.some(([base, prefix]) =>
      inPrefix32(value, base, prefix)
    );
  }
  if (family !== 6) return false;
  const bytes = parseIpv6(address);
  if (!bytes) return false;
  // Globally routable unicast is currently 2000::/3. Explicit exclusions below
  // cover standards-reserved sub-ranges within it.
  if ((bytes[0] & 0xe0) !== 0x20) return false;
  return !IPV6_FORBIDDEN.some(([prefix, bits]) =>
    inPrefix128(bytes, prefix, bits)
  );
}

const IPV4_FORBIDDEN: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa83f8110, 32], // Azure platform virtual IP.
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc01fc400, 24],
  [0xc034c100, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc0af3000, 24],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

const IPV6_FORBIDDEN: ReadonlyArray<readonly [Uint8Array, number]> = [
  [ipv6Prefix("2001::"), 23], // IETF protocol assignments and anycast.
  [ipv6Prefix("2001:0000::"), 32], // Teredo.
  [ipv6Prefix("2001:0002::"), 48], // Benchmark.
  [ipv6Prefix("2001:0010::"), 28], // ORCHIDv1.
  [ipv6Prefix("2001:0020::"), 28], // ORCHIDv2.
  [ipv6Prefix("2001:0db8::"), 32], // Documentation.
  [ipv6Prefix("2002::"), 16], // 6to4.
  [ipv6Prefix("3fff::"), 20], // Documentation.
];

function inPrefix32(value: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

function parseIpv6(value: string): Uint8Array | null {
  const halves = value.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (left.some(invalidHextet) || right.some(invalidHextet)) return null;
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null;
  }
  const words = [
    ...left.map((part) => parseInt(part, 16)),
    ...Array(missing).fill(0),
    ...right.map((part) => parseInt(part, 16)),
  ];
  if (words.length !== 8) return null;
  const bytes = new Uint8Array(16);
  words.forEach((word, index) => {
    bytes[index * 2] = word >>> 8;
    bytes[index * 2 + 1] = word & 0xff;
  });
  return bytes;
}

function invalidHextet(value: string): boolean {
  return !/^[0-9a-f]{1,4}$/.test(value);
}

function ipv6Prefix(value: string): Uint8Array {
  const parsed = parseIpv6(value);
  if (!parsed) throw new Error("Invalid static IPv6 prefix");
  return parsed;
}

function inPrefix128(
  value: Uint8Array,
  prefix: Uint8Array,
  bits: number
): boolean {
  const complete = Math.floor(bits / 8);
  for (let index = 0; index < complete; index += 1) {
    if (value[index] !== prefix[index]) return false;
  }
  const remaining = bits % 8;
  if (remaining === 0) return true;
  const mask = 0xff << (8 - remaining);
  return (value[complete] & mask) === (prefix[complete] & mask);
}
