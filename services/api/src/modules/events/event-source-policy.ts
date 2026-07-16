import { isIP } from "node:net";
import type { CertifiedFeedUrl } from "./events.types.js";

const ALLOWLIST_ERROR = "Invalid event source allowlist";
const URL_ERROR = "Invalid event source URL";

export function parseAllowedEventHosts(raw: unknown): Set<string> {
  if (typeof raw !== "string" || raw.length === 0 || raw.trim() !== raw) {
    throw new Error(ALLOWLIST_ERROR);
  }
  const hosts = raw.split(",");
  const result = new Set<string>();
  for (const host of hosts) {
    if (!isValidAsciiHostname(host) || result.has(host)) {
      throw new Error(ALLOWLIST_ERROR);
    }
    result.add(host);
  }
  if (result.size === 0) throw new Error(ALLOWLIST_ERROR);
  return result;
}

export function certifyEventFeedUrl(
  raw: unknown,
  allowedHosts: ReadonlySet<string>
): CertifiedFeedUrl {
  if (typeof raw !== "string") throw new Error(URL_ERROR);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(URL_ERROR);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.href.includes("#") ||
    isIP(url.hostname) !== 0 ||
    !isValidAsciiHostname(url.hostname) ||
    !allowedHosts.has(url.hostname)
  ) {
    throw new Error(URL_ERROR);
  }
  return { href: url.href, hostname: url.hostname };
}

function isValidAsciiHostname(value: string): boolean {
  if (
    value.length < 1 ||
    value.length > 253 ||
    value !== value.toLowerCase() ||
    [...value].some((character) => character.charCodeAt(0) > 0x7f) ||
    value.endsWith(".") ||
    isIP(value) !== 0
  ) {
    return false;
  }
  const labels = value.split(".");
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  );
}
