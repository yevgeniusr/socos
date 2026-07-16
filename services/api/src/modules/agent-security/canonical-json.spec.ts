import { canonicalJson, hashCanonicalJson } from "./canonical-json.js";

describe("canonical agent request hashing", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(
      canonicalJson({ z: 1, a: { y: true, x: [3, { b: 2, a: 1 }] } })
    ).toBe('{"a":{"x":[3,{"a":1,"b":2}],"y":true},"z":1}');
  });

  it("produces the same hash for equivalent key ordering", () => {
    expect(hashCanonicalJson({ b: 2, a: 1 })).toBe(
      hashCanonicalJson({ a: 1, b: 2 })
    );
  });

  it("distinguishes arrays, scalar types, null, and changed content", () => {
    const hashes = [
      hashCanonicalJson([1, 2]),
      hashCanonicalJson([2, 1]),
      hashCanonicalJson("1"),
      hashCanonicalJson(1),
      hashCanonicalJson(null),
    ];
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    BigInt(1),
    () => undefined,
    new Date("2026-07-16T00:00:00.000Z"),
    { unsafe: undefined },
  ])("rejects non-JSON value %p", (value) => {
    expect(() => canonicalJson(value)).toThrow("Invalid canonical JSON value");
  });

  it("rejects cyclic objects", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow("Invalid canonical JSON value");
  });
});
