import type { ProposalHistoryResponse, ProposalPreview } from "@/lib/cockpit-contracts";

type Proposal = ProposalHistoryResponse["proposals"][number];

function Preview({ preview }: { preview: ProposalPreview }) {
  if (preview.type === "message") return <><p className="font-bold">Message to {preview.contact.name}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm text-on-surface-variant">{preview.body}</p><p className="mt-2 text-xs uppercase text-on-surface-variant">Channel: {preview.channel}</p></>;
  if (preview.type === "introduction") return <><p className="font-bold">Introduce {preview.contact.name} and {preview.otherContact.name}</p>{preview.context ? <p className="mt-2 break-words text-sm text-on-surface-variant">{preview.context}</p> : null}</>;
  if (preview.type === "invitation") return <><p className="font-bold">Invite {preview.contact.name}</p><p className="mt-2 break-words text-sm text-on-surface-variant">{preview.title}</p>{preview.scheduledAt ? <p className="mt-1 text-xs text-on-surface-variant">{new Date(preview.scheduledAt).toLocaleString()}</p> : null}</>;
  if (preview.type === "merge") return <p className="font-bold">Merge {preview.sourceContact.name} into {preview.targetContact.name}</p>;
  if (preview.type === "delete") return <p className="font-bold">Delete {preview.label}</p>;
  return <p className="font-bold text-tertiary-fixed-dim">{preview.label}</p>;
}

function statusCopy(proposal: Proposal): string {
  if (proposal.status === "approved") {
    if (!proposal.grant) return "Approval granted";
    if (proposal.grant.outbox?.status === "completed") return "Execution completed";
    if (proposal.grant.outbox) return `Approval granted · execution ${proposal.grant.outbox.status}`;
    return `Approval granted · grant ${proposal.grant.status}`;
  }
  if (proposal.status === "pending") return "Awaiting your decision";
  if (proposal.status === "rejected") return "Rejected";
  return "Expired without approval";
}

export default function ProposalRow({ proposal }: { proposal: Proposal }) {
  return (
    <li className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><Preview preview={proposal.preview} /></div>
        <span className="rounded-full border border-outline-variant/40 px-2 py-1 text-[11px] font-black uppercase text-on-surface-variant">{proposal.actionType}</span>
      </div>
      <div className="mt-4 border-t border-outline-variant/20 pt-3 text-xs text-on-surface-variant">
        <p className="font-bold text-on-surface">{statusCopy(proposal)}</p>
        <p className="mt-1">Proposed by {proposal.client.name} · {new Date(proposal.createdAt).toLocaleString()}</p>
        {proposal.grant ? <p className="mt-1">Grant expires {new Date(proposal.grant.expiresAt).toLocaleString()}</p> : null}
      </div>
      {proposal.status === "pending" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled title="Decision actions are being verified" className="min-h-11 rounded-lg bg-primary px-4 text-sm font-black text-on-primary opacity-60">Approve</button>
          <button type="button" disabled title="Decision actions are being verified" className="min-h-11 rounded-lg border border-outline-variant/40 px-4 text-sm font-bold text-on-surface-variant opacity-60">Reject</button>
        </div>
      ) : null}
    </li>
  );
}
