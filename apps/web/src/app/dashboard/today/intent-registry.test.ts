import { describe, expect, it } from "vitest";

import { IntentRegistry } from "./intent-registry";

describe("IntentRegistry", () => {
  it("creates server-valid keys and reuses one unresolved canonical intent", () => {
    const registry = new IntentRegistry(() => "00000000-0000-4000-8000-000000000001");
    const first = registry.keyFor("item-1", "dismiss", { reason: "Later", action: "dismiss" });
    const reordered = registry.keyFor("item-1", "dismiss", { action: "dismiss", reason: "Later" });

    expect(first).toBe(reordered);
    expect(first).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  });

  it("separates changed bodies and resolves only the matching intent", () => {
    let sequence = 0;
    const registry = new IntentRegistry(() => `intent-key-${++sequence}-valid`);
    const first = registry.keyFor("item-1", "snooze", { until: "tomorrow" });
    const changed = registry.keyFor("item-1", "snooze", { until: "next-week" });

    expect(changed).not.toBe(first);
    registry.resolve("item-1", "snooze", { until: "tomorrow" });
    expect(registry.keyFor("item-1", "snooze", { until: "next-week" })).toBe(changed);
    expect(registry.keyFor("item-1", "snooze", { until: "tomorrow" })).not.toBe(first);
  });

  it("retains the same key when a transport outcome is unknown", () => {
    const registry = new IntentRegistry(() => "intent-key-transport-failure");
    const before = registry.keyFor("quest-1", "complete", { interactionId: "interaction-1" });
    const after = registry.keyFor("quest-1", "complete", { interactionId: "interaction-1" });
    expect(after).toBe(before);
  });
});
