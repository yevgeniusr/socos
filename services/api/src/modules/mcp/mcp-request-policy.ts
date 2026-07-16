import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { Request } from "express";

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 50;
const MAX_TIMEOUT_MS = 30_000;

@Injectable()
export class McpRequestPolicy {
  assert(request: Request, body: unknown): void {
    assertJsonContent(request);
    assertBodySize(request, body);
    const authority = effectiveAuthority(request);
    assertAllowedHost(authority.hostname);
    assertAllowedOrigin(request, authority.hostname);
  }

  timeoutMs(): number {
    const configured = Number(process.env.MCP_REQUEST_TIMEOUT_MS);
    return Number.isSafeInteger(configured) &&
      configured >= MIN_TIMEOUT_MS &&
      configured <= MAX_TIMEOUT_MS
      ? configured
      : DEFAULT_TIMEOUT_MS;
  }
}

function assertJsonContent(request: Request): void {
  const contentType = singleHeader(request.headers["content-type"]);
  if (
    contentType?.split(";", 1)[0].trim().toLowerCase() !== "application/json"
  ) {
    throw new UnsupportedMediaTypeException("MCP requires JSON content");
  }
}

function assertBodySize(request: Request, body: unknown): void {
  const contentLength = singleHeader(request.headers["content-length"]);
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) {
      throw new BadRequestException("Invalid content length");
    }
    if (Number(contentLength) > MAX_BODY_BYTES) {
      throw new PayloadTooLargeException("MCP request is too large");
    }
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(body) ?? "";
  } catch {
    throw new BadRequestException("Invalid JSON body");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_BODY_BYTES) {
    throw new PayloadTooLargeException("MCP request is too large");
  }
}

function effectiveAuthority(request: Request): { hostname: string } {
  const forwarded =
    process.env.MCP_TRUST_PROXY === "true"
      ? singleHeader(request.headers["x-forwarded-host"])
      : undefined;
  return parseAuthority(forwarded ?? singleHeader(request.headers.host));
}

function parseAuthority(value: string | undefined): { hostname: string } {
  if (!value || value.includes(",") || /[\s/@]/.test(value)) {
    throw new ForbiddenException("MCP host is not allowed");
  }
  try {
    const parsed = new URL(`http://${value}`);
    if (!parsed.hostname || parsed.pathname !== "/") throw new Error("invalid");
    return { hostname: normalizeHostname(parsed.hostname) };
  } catch {
    throw new ForbiddenException("MCP host is not allowed");
  }
}

function assertAllowedHost(hostname: string): void {
  const configured = parseList(process.env.MCP_ALLOWED_HOSTS).map(
    (value) => parseAuthority(value).hostname
  );
  const isLocal =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "::1"].includes(hostname);
  if (!isLocal && !configured.includes(hostname)) {
    throw new ForbiddenException("MCP host is not allowed");
  }
}

function assertAllowedOrigin(request: Request, hostname: string): void {
  const value = singleHeader(request.headers.origin);
  if (value === undefined) return;

  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new ForbiddenException("MCP origin is not allowed");
  }
  if (
    (origin.protocol !== "https:" && origin.protocol !== "http:") ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new ForbiddenException("MCP origin is not allowed");
  }

  const configured = parseList(process.env.MCP_ALLOWED_ORIGINS).map(
    normalizeOrigin
  );
  const sameHost = normalizeHostname(origin.hostname) === hostname;
  const allowed =
    configured.length > 0
      ? configured.includes(origin.origin.toLowerCase())
      : sameHost;
  if (!allowed) {
    throw new ForbiddenException("MCP origin is not allowed");
  }
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    throw new ForbiddenException("MCP origin is not allowed");
  }
}

function normalizeHostname(value: string): string {
  return value.toLowerCase().replace(/\.$/, "");
}

function parseList(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function singleHeader(
  value: string | string[] | undefined
): string | undefined {
  return typeof value === "string" ? value : undefined;
}
