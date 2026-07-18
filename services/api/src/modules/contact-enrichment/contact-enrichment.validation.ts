import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { EnrichmentField } from "./contact-enrichment.types.js";

const SOCIAL_HOSTS: Readonly<Record<string, readonly string[] | "public">> = {
  linkedin: ["linkedin.com", "www.linkedin.com"],
  twitter: ["twitter.com", "www.twitter.com", "x.com", "www.x.com"],
  x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
  instagram: ["instagram.com", "www.instagram.com"],
  github: ["github.com", "www.github.com"],
  facebook: ["facebook.com", "www.facebook.com"],
  website: "public",
};

const STRING_LIMITS: Partial<Record<EnrichmentField, number>> = {
  bio: 5_000,
  company: 300,
  jobTitle: 300,
  firstMetContext: 2_000,
};

export function normalizeCandidateValue(
  fieldName: EnrichmentField,
  value: Prisma.JsonValue
): Prisma.JsonValue {
  if (fieldName === "photo") return safePublicHttpsUrl(value);
  if (fieldName === "socialLinks") return socialLinks(value);
  if (fieldName === "birthday") return birthday(value);
  if (fieldName === "anniversary" || fieldName === "firstMetDate") {
    return fullDate(value);
  }

  const limit = STRING_LIMITS[fieldName];
  if (!limit || typeof value !== "string") throw invalidValue();
  const normalized = value.trim().replace(/\r\n/g, "\n");
  if (!normalized || normalized.length > limit) throw invalidValue();
  return normalized;
}

function birthday(value: Prisma.JsonValue): Prisma.JsonValue {
  if (typeof value === "string") return fullDate(value);
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw invalidValue();
  }
  const keys = Object.keys(value);
  const month = value.month;
  const day = value.day;
  if (
    keys.length !== 2 ||
    !keys.includes("month") ||
    !keys.includes("day") ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !validMonthDay(month as number, day as number)
  ) {
    throw invalidValue();
  }
  return { month: month as number, day: day as number };
}

function fullDate(value: Prisma.JsonValue): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidValue();
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw invalidValue();
  }
  return value;
}

function socialLinks(value: Prisma.JsonValue): Prisma.JsonObject {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw invalidValue();
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 10) throw invalidValue();
  const normalized: Prisma.JsonObject = {};
  for (const [rawKey, rawUrl] of entries.sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const key = rawKey.toLowerCase();
    const allowed = SOCIAL_HOSTS[key];
    if (!allowed || typeof rawUrl !== "string") throw invalidValue();
    const url = safePublicHttpsUrl(rawUrl);
    const hostname = new URL(url).hostname.toLowerCase();
    if (allowed !== "public" && !allowed.includes(hostname)) {
      throw invalidValue();
    }
    normalized[key] = url;
  }
  return normalized;
}

function safePublicHttpsUrl(value: Prisma.JsonValue): string {
  if (typeof value !== "string" || value.length > 2_048) throw invalidValue();
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalidValue();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname ||
    isPrivateHostname(url.hostname)
  ) {
    throw invalidValue();
  }
  url.hash = "";
  return url.toString();
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (
    host === "localhost" ||
    host === "::1" ||
    host.includes(":") ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test")
  ) {
    return true;
  }
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }
  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    octets[0] >= 224
  );
}

function validMonthDay(month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(2000, month, 0)).getUTCDate();
}

function invalidValue(): BadRequestException {
  return new BadRequestException("Invalid enrichment candidate value");
}
