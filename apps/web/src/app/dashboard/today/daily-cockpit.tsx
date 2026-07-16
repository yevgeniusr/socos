"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useDashboard } from "../_components/dashboard-shell";
import { ApiError, apiJson } from "@/lib/api-client";
import type {
  DailyBrief,
  ProposalHistoryResponse,
  StreakResponse,
  UpcomingRemindersResponse,
} from "@/lib/cockpit-contracts";
import BriefFocusList from "./_components/brief-focus-list";
import MomentumSummary from "./_components/momentum-summary";
import QuestList from "./_components/quest-list";
import ReminderList from "./_components/reminder-list";

type Loadable<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
type BriefState = Loadable<DailyBrief> | { status: "not-ready" };

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function PanelFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-error/40 bg-error-container/20 p-3 text-sm text-on-error-container">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-lg border border-error/40 px-3 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-error">Retry</button>
    </div>
  );
}

function LoadingLines({ label }: { label: string }) {
  return <div aria-label={label} aria-busy="true" className="space-y-2"><div className="h-16 animate-pulse rounded-lg bg-surface-container-high" /><div className="h-16 animate-pulse rounded-lg bg-surface-container-high" /></div>;
}

export default function DailyCockpit() {
  const { user, stats } = useDashboard();
  const [brief, setBrief] = useState<BriefState>({ status: "loading" });
  const [reminders, setReminders] = useState<Loadable<UpcomingRemindersResponse>>({ status: "loading" });
  const [streak, setStreak] = useState<Loadable<StreakResponse>>({ status: "loading" });
  const [approvals, setApprovals] = useState<Loadable<ProposalHistoryResponse>>({ status: "loading" });
  const [generating, setGenerating] = useState(false);

  const loadBrief = useCallback((signal?: AbortSignal) => {
    setBrief({ status: "loading" });
    void apiJson<DailyBrief>("/api/briefs/today", { signal })
      .then((data) => setBrief({ status: "ready", data }))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        if (error instanceof ApiError && error.status === 404 && error.code === "BRIEF_NOT_READY") setBrief({ status: "not-ready" });
        else setBrief({ status: "error", message: messageOf(error, "Could not load today's brief.") });
      });
  }, []);

  const loadReminders = useCallback((signal?: AbortSignal) => {
    setReminders({ status: "loading" });
    void apiJson<UpcomingRemindersResponse>("/api/reminders/upcoming", { signal })
      .then((data) => setReminders({ status: "ready", data }))
      .catch((error: unknown) => { if (!signal?.aborted) setReminders({ status: "error", message: messageOf(error, "Could not load reminders.") }); });
  }, []);

  const loadStreak = useCallback((signal?: AbortSignal) => {
    setStreak({ status: "loading" });
    void apiJson<StreakResponse>("/api/gamification/streak", { signal })
      .then((data) => setStreak({ status: "ready", data }))
      .catch((error: unknown) => { if (!signal?.aborted) setStreak({ status: "error", message: messageOf(error, "Could not load streak.") }); });
  }, []);

  const loadApprovals = useCallback((signal?: AbortSignal) => {
    setApprovals({ status: "loading" });
    void apiJson<ProposalHistoryResponse>("/api/agent-proposals/history?status=all&limit=20&offset=0", { signal })
      .then((data) => setApprovals({ status: "ready", data }))
      .catch((error: unknown) => { if (!signal?.aborted) setApprovals({ status: "error", message: messageOf(error, "Could not load approvals.") }); });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadBrief(controller.signal);
    loadReminders(controller.signal);
    loadStreak(controller.signal);
    loadApprovals(controller.signal);
    return () => controller.abort();
  }, [loadApprovals, loadBrief, loadReminders, loadStreak]);

  async function generateBrief() {
    setGenerating(true);
    try {
      const data = await apiJson<DailyBrief>("/api/briefs/generate", { method: "POST" });
      setBrief({ status: "ready", data });
    } catch (error) {
      setBrief({ status: "error", message: messageOf(error, "Could not generate today's brief.") });
    } finally {
      setGenerating(false);
    }
  }

  const timeZone = brief.status === "ready" ? brief.data.timeZone : "Asia/Dubai";
  const pendingApprovals = approvals.status === "ready" ? approvals.data.proposals.filter((proposal) => proposal.status === "pending").length : 0;

  return (
    <main className="mx-auto min-w-0 max-w-[1240px] px-3 py-5 sm:px-6 sm:py-7 xl:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-secondary">Personal workspace</p>
          <h1 className="mt-1 text-2xl font-black sm:text-3xl">Today</h1>
          <p className="mt-1 text-sm text-on-surface-variant">A bounded view of the relationships that matter now.</p>
        </div>
        <Link href="/dashboard/approvals?status=pending" className="flex min-h-11 items-center gap-2 rounded-lg border border-outline-variant/40 px-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <span className="material-symbols-outlined text-[19px]" aria-hidden="true">approval</span>
          {pendingApprovals} pending approvals
        </Link>
      </header>

      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,.8fr)]">
        <div className="min-w-0">
          {brief.status === "loading" ? <LoadingLines label="Loading today's brief" /> : null}
          {brief.status === "not-ready" ? (
            <section className="border-y border-outline-variant/25 py-8">
              <h2 className="text-lg font-black">Today’s brief is ready to build</h2>
              <p className="mt-2 text-sm text-on-surface-variant">Generate a durable recommendation set from your current CRM data.</p>
              <button type="button" disabled={generating} onClick={() => void generateBrief()} className="mt-4 min-h-11 rounded-lg bg-primary px-4 text-sm font-black text-on-primary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary">{generating ? "Generating…" : "Generate today's brief"}</button>
            </section>
          ) : null}
          {brief.status === "error" ? <PanelFailure message={brief.message} onRetry={() => loadBrief()} /> : null}
          {brief.status === "ready" ? <BriefFocusList brief={brief.data} /> : null}
        </div>

        <aside className="min-w-0 space-y-5" aria-label="Today utilities">
          <MomentumSummary level={user?.level ?? 1} xpProgress={stats?.xpProgress ?? 0} xpNeeded={stats?.xpNeeded ?? 100} streak={streak.status === "ready" ? streak.data : null} />
          {streak.status === "error" ? <PanelFailure message={streak.message} onRetry={() => loadStreak()} /> : null}
          {brief.status === "ready" ? <QuestList quests={brief.data.quests} /> : null}
          {reminders.status === "loading" ? <LoadingLines label="Loading reminders" /> : null}
          {reminders.status === "error" ? <PanelFailure message={reminders.message} onRetry={() => loadReminders()} /> : null}
          {reminders.status === "ready" ? <ReminderList data={reminders.data} timeZone={timeZone} /> : null}
          <section aria-labelledby="approval-summary-heading" className="border-t border-outline-variant/25 pt-5">
            <div className="flex items-center justify-between gap-3"><h2 id="approval-summary-heading" className="text-base font-black">Agent approvals</h2><Link href="/dashboard/approvals" className="min-h-11 py-3 text-xs font-bold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">View history</Link></div>
            {approvals.status === "loading" ? <LoadingLines label="Loading approvals" /> : null}
            {approvals.status === "error" ? <PanelFailure message={approvals.message} onRetry={() => loadApprovals()} /> : null}
            {approvals.status === "ready" ? <p className="mt-2 text-sm text-on-surface-variant">{pendingApprovals ? `${pendingApprovals} proposal${pendingApprovals === 1 ? "" : "s"} need a decision.` : "No proposals need a decision."}</p> : null}
          </section>
        </aside>
      </div>
    </main>
  );
}
