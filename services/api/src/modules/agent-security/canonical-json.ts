import { createHash } from "node:crypto";

const MAX_DEPTH = 64;

export function canonicalJson(value: unknown): string {
  return serialize(value, new Set<object>(), 0);
}

export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function serialize(value: unknown, seen: Set<object>, depth: number): string {
  if (depth > MAX_DEPTH) throw invalidValue();
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidValue();
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") throw invalidValue();

  if (seen.has(value)) throw invalidValue();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((entry) => serialize(entry, seen, depth + 1))
        .join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidValue();
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serialize(object[key], seen, depth + 1)}`
      )
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function invalidValue(): Error {
  return new Error("Invalid canonical JSON value");
}
