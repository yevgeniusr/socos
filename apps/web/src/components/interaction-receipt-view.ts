import type { InteractionReceiptEnvelope } from "@/lib/contact-contracts";

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "no previous contact";
}

export function interactionLastContactLabel(
  value: InteractionReceiptEnvelope["lastContact"]
): string {
  if (!value.advanced)
    return `Last contact unchanged at ${formatTimestamp(value.resultingAt)}`;
  return `Last contact advanced from ${formatTimestamp(value.previousAt)} to ${formatTimestamp(value.resultingAt)}`;
}

export function interactionXpLabel(
  value: InteractionReceiptEnvelope["xp"]
): string {
  return `Interaction +${value.interactionDelta} XP; achievements +${value.achievementDelta} XP; total +${value.totalDelta} XP`;
}
