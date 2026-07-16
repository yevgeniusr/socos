"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { apiJson } from "@/lib/api-client";
import type { ProposalHistoryResponse, ProposalHistoryStatus } from "@/lib/cockpit-contracts";
import ProposalRow from "./_components/proposal-row";

const statuses: ProposalHistoryStatus[] = ["all", "pending", "approved", "rejected", "expired"];

export default function ApprovalsWorkspace() {
  const searchParams = useSearchParams();
  const requested = searchParams.get("status");
  const status: ProposalHistoryStatus = statuses.includes(requested as ProposalHistoryStatus) ? (requested as ProposalHistoryStatus) : "all";
  const [data, setData] = useState<ProposalHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    void apiJson<ProposalHistoryResponse>(`/api/agent-proposals/history?status=${status}&limit=20&offset=0`, { signal })
      .then(setData)
      .catch((reason: unknown) => { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Could not load approval history."); })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  }, [status]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id);
    setRowErrors((current) => ({ ...current, [id]: "" }));
    try {
      await apiJson(`/api/agent-proposals/${encodeURIComponent(id)}/${decision}`, { method: "POST" });
      load();
    } catch (reason) {
      setRowErrors((current) => ({ ...current, [id]: reason instanceof Error ? reason.message : `Could not ${decision} proposal.` }));
    } finally { setBusyId(null); }
  }

  return (
    <main className="mx-auto min-w-0 max-w-[980px] px-3 py-5 sm:px-6 sm:py-7 xl:px-8">
      <header className="mb-5">
        <p className="text-xs font-black uppercase text-secondary">Human decisions</p>
        <h1 className="mt-1 text-2xl font-black sm:text-3xl">Approvals</h1>
        <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">Review risky agent proposals. Approval creates a short-lived grant; execution is reported separately.</p>
      </header>

      <nav aria-label="Approval status" className="mb-5 flex min-w-0 gap-1 overflow-x-auto border-b border-outline-variant/25">
        {statuses.map((value) => (
          <Link key={value} href={`/dashboard/approvals?status=${value}`} aria-current={status === value ? "page" : undefined} className={`flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-bold capitalize focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${status === value ? "border-primary text-primary" : "border-transparent text-on-surface-variant"}`}>{value}</Link>
        ))}
      </nav>

      {loading ? <div aria-busy="true" aria-label="Loading approval history" className="space-y-3"><div className="h-32 animate-pulse rounded-lg bg-surface-container-high" /><div className="h-32 animate-pulse rounded-lg bg-surface-container-high" /></div> : null}
      {error ? <div role="alert" className="rounded-lg border border-error/40 bg-error-container/20 p-4 text-sm text-on-error-container"><p>{error}</p><button type="button" onClick={() => load()} className="mt-3 min-h-11 rounded-lg border border-error/40 px-3 font-bold">Retry</button></div> : null}
      {!loading && !error && data?.proposals.length ? <ul className="space-y-3">{data.proposals.map((proposal) => <ProposalRow key={proposal.id} proposal={proposal} busy={busyId === proposal.id} error={rowErrors[proposal.id] ?? ""} onApprove={(id) => decide(id, "approve")} onReject={(id) => decide(id, "reject")} />)}</ul> : null}
      {!loading && !error && data && !data.proposals.length ? <p className="border-y border-outline-variant/25 py-8 text-sm text-on-surface-variant">No {status === "all" ? "" : `${status} `}proposals.</p> : null}
      {data && data.total > data.offset + data.limit ? <p className="mt-4 text-xs text-on-surface-variant">Showing {data.offset + 1}-{Math.min(data.total, data.offset + data.limit)} of {data.total}</p> : null}
    </main>
  );
}
