import { describe, expect, it } from "vitest";

import { getFocusLoopTarget } from "./dialog-focus";

describe("getFocusLoopTarget", () => {
  it("wraps focus at both dialog boundaries", () => {
    const first = { id: "first" };
    const middle = { id: "middle" };
    const last = { id: "last" };
    const controls = [first, middle, last];

    expect(getFocusLoopTarget(controls, last, false)).toBe(first);
    expect(getFocusLoopTarget(controls, first, true)).toBe(last);
    expect(getFocusLoopTarget(controls, middle, false)).toBeNull();
    expect(getFocusLoopTarget(controls, middle, true)).toBeNull();
  });

  it("returns focus to the dialog when it is already outside", () => {
    const first = { id: "first" };
    const last = { id: "last" };
    const outside = { id: "outside" };
    const controls = [first, last];

    expect(getFocusLoopTarget(controls, outside, false)).toBe(first);
    expect(getFocusLoopTarget(controls, outside, true)).toBe(last);
  });

  it("does not select a target when the dialog has no controls", () => {
    expect(getFocusLoopTarget([], null, false)).toBeNull();
  });
});
