import type {
  ProposalHistoryResponse,
  ProposalPreview,
} from "@/lib/cockpit-contracts";
import type { Ref } from "react";
import { proposalReceipt, proposalStatusCopy } from "../proposal-view";

type Proposal = ProposalHistoryResponse["proposals"][number];

function Preview({ preview }: { preview: ProposalPreview }) {
  if (preview.type === "message")
    return (
      <>
        <p className="font-bold">Message to {preview.contact.name}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-on-surface-variant">
          {preview.body}
        </p>
        <p className="mt-2 text-xs uppercase text-on-surface-variant">
          Channel: {preview.channel}
        </p>
      </>
    );
  if (preview.type === "introduction")
    return (
      <>
        <p className="font-bold">
          Introduce {preview.contact.name} and {preview.otherContact.name}
        </p>
        {preview.context ? (
          <p className="mt-2 break-words text-sm text-on-surface-variant">
            {preview.context}
          </p>
        ) : null}
      </>
    );
  if (preview.type === "invitation")
    return (
      <>
        <p className="font-bold">Invite {preview.contact.name}</p>
        <p className="mt-2 break-words text-sm text-on-surface-variant">
          {preview.title}
        </p>
        {preview.scheduledAt ? (
          <p className="mt-1 text-xs text-on-surface-variant">
            {new Date(preview.scheduledAt).toLocaleString()}
          </p>
        ) : null}
      </>
    );
  if (preview.type === "merge")
    return (
      <p className="font-bold">
        Merge {preview.sourceContact.name} into {preview.targetContact.name}
      </p>
    );
  if (preview.type === "delete")
    return <p className="font-bold">Delete {preview.label}</p>;
  return <p className="font-bold text-tertiary-fixed-dim">{preview.label}</p>;
}

export default function ProposalRow({
  proposal,
  busy,
  error,
  onApprove,
  onReject,
  receiptHeadingRef,
}: {
  proposal: Proposal;
  busy: boolean;
  error: string;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  receiptHeadingRef?: Ref<HTMLHeadingElement>;
}) {
  const reviewable =
    proposal.status === "pending" &&
    proposal.actionType !== "unavailable" &&
    proposal.preview.type !== "unavailable";
  const receipt = proposalReceipt(proposal);
  return (
    <li className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Preview preview={proposal.preview} />
        </div>
        <span className="rounded-full border border-outline-variant/40 px-2 py-1 text-[11px] font-black uppercase text-on-surface-variant">
          {proposal.actionType}
        </span>
      </div>
      <div className="mt-4 border-t border-outline-variant/20 pt-3 text-xs text-on-surface-variant">
        {receipt ? (
          <section aria-label="Decision receipt">
            <h2
              ref={receiptHeadingRef}
              tabIndex={-1}
              className="font-bold text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              Decision receipt
            </h2>
            <dl className="mt-2 grid gap-1.5 sm:grid-cols-[6rem_1fr]">
              <dt className="font-bold text-on-surface-variant">Decision</dt>
              <dd className="text-on-surface">{receipt.decision}</dd>
              <dt className="font-bold text-on-surface-variant">Execution</dt>
              <dd className="text-on-surface">{receipt.execution}</dd>
              <dt className="font-bold text-on-surface-variant">Progress</dt>
              <dd className="text-on-surface">{receipt.progress}</dd>
            </dl>
          </section>
        ) : (
          <p className="font-bold text-on-surface">
            {proposalStatusCopy(proposal)}
          </p>
        )}
        <p className="mt-1">
          Proposed by {proposal.client.name} ·{" "}
          {new Date(proposal.createdAt).toLocaleString()}
        </p>
        <p className="mt-1">
          Proposal expires {new Date(proposal.expiresAt).toLocaleString()}
        </p>
        {proposal.decidedAt ? (
          <p className="mt-1">
            Decision recorded {new Date(proposal.decidedAt).toLocaleString()}
          </p>
        ) : null}
        {proposal.grant ? (
          <>
            <p className="mt-1">
              Grant expires{" "}
              {new Date(proposal.grant.expiresAt).toLocaleString()}
            </p>
            {proposal.grant.consumedAt ? (
              <p className="mt-1">
                Grant consumed{" "}
                {new Date(proposal.grant.consumedAt).toLocaleString()}
              </p>
            ) : null}
            {proposal.grant.revokedAt ? (
              <p className="mt-1">
                Grant revoked{" "}
                {new Date(proposal.grant.revokedAt).toLocaleString()}
              </p>
            ) : null}
            {proposal.grant.outbox ? (
              <p className="mt-1">
                Execution attempts: {proposal.grant.outbox.attempts}
                {proposal.grant.outbox.completedAt
                  ? ` · completed ${new Date(proposal.grant.outbox.completedAt).toLocaleString()}`
                  : ""}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
      {reviewable ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onApprove(proposal.id)}
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-black text-on-primary disabled:opacity-60"
          >
            {busy ? "Saving..." : "Approve"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onReject(proposal.id)}
            className="min-h-11 rounded-lg border border-outline-variant/40 px-4 text-sm font-bold text-on-surface-variant disabled:opacity-60"
          >
            Reject
          </button>
        </div>
      ) : null}
      {proposal.status === "pending" && !reviewable ? (
        <p className="mt-4 text-sm font-bold text-error">
          This proposal cannot be reviewed or approved.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      ) : null}
    </li>
  );
}
