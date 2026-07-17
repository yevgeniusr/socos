import type { Ref } from "react";
import type { InteractionReceiptEnvelope } from "@/lib/contact-contracts";
import {
  interactionLastContactLabel,
  interactionXpLabel,
} from "./interaction-receipt-view";

export default function InteractionReceipt({
  receipt,
  headingRef,
  detail = "exact",
  live = true,
}: {
  receipt: InteractionReceiptEnvelope;
  headingRef?: Ref<HTMLHeadingElement>;
  detail?: "exact" | "compact";
  live?: boolean;
}) {
  return (
    <section
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
      className="border-t border-secondary/40 bg-secondary/5 px-3 py-4"
    >
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="text-base font-black text-secondary"
      >
        Interaction recorded
      </h3>
      <p className="mt-1 break-words text-sm font-bold [overflow-wrap:anywhere]">
        {detail === "exact"
          ? receipt.interaction.title || receipt.interaction.type
          : receipt.interaction.type}{" "}
        ·{" "}
        {new Date(receipt.interaction.occurredAt).toLocaleString()}
      </p>
      {detail === "exact" && receipt.interaction.content ? (
        <p className="mt-1 break-words whitespace-pre-wrap text-sm text-on-surface-variant [overflow-wrap:anywhere]">
          {receipt.interaction.content}
        </p>
      ) : null}
      {detail === "exact" && receipt.interaction.summary ? (
        <p className="mt-1 break-words text-sm text-on-surface-variant [overflow-wrap:anywhere]">
          {receipt.interaction.summary}
        </p>
      ) : null}
      {detail === "exact" &&
      (receipt.interaction.duration || receipt.interaction.location) ? (
        <p className="mt-1 break-words text-xs text-on-surface-variant [overflow-wrap:anywhere]">
          {[
            receipt.interaction.duration
              ? `${receipt.interaction.duration} minutes`
              : null,
            receipt.interaction.location,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      <p className="mt-1 text-sm text-on-surface-variant">
        {interactionLastContactLabel(receipt.lastContact)}
      </p>
      <p className="mt-1 text-sm font-bold text-secondary">
        {interactionXpLabel(receipt.xp)}
      </p>
      <p className="mt-1 text-xs text-on-surface-variant">
        Total {receipt.xp.totalAfter} XP · Level {receipt.xp.levelAfter}
      </p>
      <p className="mt-1 text-sm font-bold">{receipt.outcome}</p>
    </section>
  );
}
