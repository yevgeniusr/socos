import { createHash } from "node:crypto";

export const CALENDAR_RECONCILIATION_SLOTS = 96;

export function reconciliationSlot(sourceId: string): number {
  const digest = createHash("sha256").update(sourceId, "utf8").digest();
  return digest.readUInt32BE(0) % CALENDAR_RECONCILIATION_SLOTS;
}
