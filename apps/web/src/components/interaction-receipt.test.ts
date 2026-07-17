import { describe, expect, it } from "vitest";
import {
  interactionLastContactLabel,
  interactionXpLabel,
} from "./interaction-receipt-view";

describe("interaction receipt presentation", () => {
  it("keeps a backfill result and XP sources explicit", () => {
    expect(
      interactionLastContactLabel({
        previousAt: "2026-07-16T12:00:00.000Z",
        resultingAt: "2026-07-16T12:00:00.000Z",
        advanced: false,
      })
    ).toContain("unchanged");
    expect(
      interactionXpLabel({
        interactionDelta: 10,
        achievementDelta: 50,
        totalDelta: 60,
        totalAfter: 160,
        levelAfter: 2,
      })
    ).toBe("Interaction +10 XP; achievements +50 XP; total +60 XP");
  });
});
