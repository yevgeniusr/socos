"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDashboard } from "../_components/dashboard-shell";
import { ApiError, apiJson } from "@/lib/api-client";
import type { InteractionReceiptEnvelope } from "@/lib/contact-contracts";
import InteractionReceipt from "@/components/interaction-receipt";
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
import QuestCompletionDialog from "./_components/quest-completion-dialog";
import ReminderDialog from "./_components/reminder-dialog";
import { IntentRegistry } from "./intent-registry";
import {
  formatBriefDate,
  momentumState,
  type QuestReceipt,
  type ReminderDraft,
  type ReminderReceipt,
} from "./cockpit-view";

type Loadable<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
type BriefState = Loadable<DailyBrief> | { status: "not-ready" };

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function PanelFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-error/40 bg-error-container/20 p-3 text-sm text-on-error-container"
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 min-h-11 rounded-lg border border-error/40 px-3 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-error"
      >
        Retry
      </button>
    </div>
  );
}

function LoadingLines({ label }: { label: string }) {
  return (
    <div aria-label={label} aria-busy="true" className="space-y-2">
      <div className="h-16 animate-pulse rounded-lg bg-surface-container-high" />
      <div className="h-16 animate-pulse rounded-lg bg-surface-container-high" />
    </div>
  );
}

export default function DailyCockpit() {
  const {
    user,
    stats,
    statsStatus,
    refreshDashboardStats,
    refreshUpcomingReminders,
  } = useDashboard();
  const [brief, setBrief] = useState<BriefState>({ status: "loading" });
  const [reminders, setReminders] = useState<
    Loadable<UpcomingRemindersResponse>
  >({ status: "loading" });
  const [streak, setStreak] = useState<Loadable<StreakResponse>>({
    status: "loading",
  });
  const [approvals, setApprovals] = useState<Loadable<ProposalHistoryResponse>>(
    { status: "loading" }
  );
  const [generating, setGenerating] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [busyReminderId, setBusyReminderId] = useState<string | null>(null);
  const [reminderErrors, setReminderErrors] = useState<Record<string, string>>(
    {}
  );
  const [reminderDraft, setReminderDraft] = useState<ReminderDraft | null>(null);
  const [reminderReceipt, setReminderReceipt] =
    useState<ReminderReceipt | null>(null);
  const [selectedQuest, setSelectedQuest] = useState<
    DailyBrief["quests"][number] | null
  >(null);
  const [questReceipt, setQuestReceipt] = useState<
    (QuestReceipt & { timeZone: string }) | null
  >(null);
  const [questInteractionReceipt, setQuestInteractionReceipt] =
    useState<InteractionReceiptEnvelope | null>(null);
  const reminderTriggerRef = useRef<HTMLButtonElement>(null);
  const reminderReceiptFocusRef = useRef<HTMLHeadingElement>(null);
  const questTriggerRef = useRef<HTMLButtonElement>(null);
  const questReceiptFocusRef = useRef<HTMLHeadingElement>(null);
  const intents = useRef(new IntentRegistry());

  const closeReminderDialog = useCallback(
    (focusTarget: "trigger" | "receipt" = "trigger") => {
      setReminderDraft(null);
      window.requestAnimationFrame(() => {
        if (focusTarget === "receipt") reminderReceiptFocusRef.current?.focus();
        else reminderTriggerRef.current?.focus();
      });
    },
    []
  );

  const closeQuestDialog = useCallback(
    (focusTarget: "trigger" | "receipt" | "none" = "trigger") => {
      setSelectedQuest(null);
      if (focusTarget === "receipt")
        window.requestAnimationFrame(() => questReceiptFocusRef.current?.focus());
      else if (focusTarget === "trigger")
        window.requestAnimationFrame(() => questTriggerRef.current?.focus());
    },
    []
  );

  useEffect(() => {
    if (!questReceipt) return;
    const frame = window.requestAnimationFrame(() =>
      questReceiptFocusRef.current?.focus()
    );
    return () => window.cancelAnimationFrame(frame);
  }, [questReceipt]);

  const loadBrief = useCallback((signal?: AbortSignal, preserve = false) => {
    if (!preserve) setBrief({ status: "loading" });
    void apiJson<DailyBrief>("/api/briefs/today", { signal })
      .then((data) => setBrief({ status: "ready", data }))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        if (
          error instanceof ApiError &&
          error.status === 404 &&
          error.code === "BRIEF_NOT_READY"
        )
          setBrief({ status: "not-ready" });
        else
          setBrief({
            status: "error",
            message: messageOf(error, "Could not load today's brief."),
          });
      });
  }, []);

  const loadReminders = useCallback(
    (signal?: AbortSignal, preserve = false) => {
      if (!preserve) setReminders({ status: "loading" });
      void apiJson<UpcomingRemindersResponse>("/api/reminders/upcoming", {
        signal,
      })
        .then((data) => setReminders({ status: "ready", data }))
        .catch((error: unknown) => {
          if (!signal?.aborted)
            setReminders({
              status: "error",
              message: messageOf(error, "Could not load reminders."),
            });
        });
    },
    []
  );

  const loadStreak = useCallback((signal?: AbortSignal) => {
    setStreak({ status: "loading" });
    void apiJson<StreakResponse>("/api/gamification/streak", { signal })
      .then((data) => setStreak({ status: "ready", data }))
      .catch((error: unknown) => {
        if (!signal?.aborted)
          setStreak({
            status: "error",
            message: messageOf(error, "Could not load streak."),
          });
      });
  }, []);

  const loadApprovals = useCallback((signal?: AbortSignal) => {
    setApprovals({ status: "loading" });
    void apiJson<ProposalHistoryResponse>(
      "/api/agent-proposals/history?status=all&limit=20&offset=0",
      { signal }
    )
      .then((data) => setApprovals({ status: "ready", data }))
      .catch((error: unknown) => {
        if (!signal?.aborted)
          setApprovals({
            status: "error",
            message: messageOf(error, "Could not load approvals."),
          });
      });
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
      const data = await apiJson<DailyBrief>("/api/briefs/generate", {
        method: "POST",
      });
      setBrief({ status: "ready", data });
    } catch (error) {
      setBrief({
        status: "error",
        message: messageOf(error, "Could not generate today's brief."),
      });
    } finally {
      setGenerating(false);
    }
  }

  async function submitFeedback(
    itemId: string,
    body:
      | { action: "accept" }
      | { action: "snooze"; snoozedUntil: string }
      | { action: "dismiss"; reason?: string }
  ): Promise<boolean> {
    const key = intents.current.keyFor(itemId, "feedback", body);
    setBusyItemId(itemId);
    setItemErrors((current) => ({ ...current, [itemId]: "" }));
    try {
      await apiJson(
        `/api/briefs/items/${encodeURIComponent(itemId)}/feedback`,
        {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify(body),
        }
      );
      intents.current.resolve(itemId, "feedback", body);
      loadBrief(undefined, true);
      return true;
    } catch (reason) {
      setItemErrors((current) => ({
        ...current,
        [itemId]: messageOf(reason, "Could not update suggestion."),
      }));
      loadBrief(undefined, true);
      return false;
    } finally {
      setBusyItemId(null);
    }
  }

  async function completeReminder(id: string) {
    setBusyReminderId(id);
    setReminderErrors((current) => ({ ...current, [id]: "" }));
    try {
      await apiJson(`/api/reminders/${encodeURIComponent(id)}/complete`, {
        method: "PUT",
      });
      loadReminders(undefined, true);
      void refreshUpcomingReminders().catch(() => undefined);
    } catch (reason) {
      setReminderErrors((current) => ({
        ...current,
        [id]: messageOf(reason, "Could not complete reminder."),
      }));
      loadReminders(undefined, true);
      void refreshUpcomingReminders().catch(() => undefined);
    } finally {
      setBusyReminderId(null);
    }
  }

  async function refreshQuestData() {
    loadBrief();
    loadReminders();
    loadStreak();
    await Promise.allSettled([
      refreshDashboardStats(),
      refreshUpcomingReminders(),
    ]);
  }

  const timeZone =
    brief.status === "ready" ? brief.data.timeZone : "Asia/Dubai";
  const pendingApprovals =
    approvals.status === "ready"
      ? approvals.data.proposals.filter(
          (proposal) => proposal.status === "pending"
        ).length
      : 0;
  const pendingQuests =
    brief.status === "ready"
      ? brief.data.quests.filter((quest) => quest.status === "pending").length
      : 0;
  const momentum = momentumState(
    statsStatus,
    streak.status === "error"
      ? "error"
      : streak.status === "ready"
        ? "ready"
        : "loading"
  );

  return (
    <main className="mx-auto min-w-0 max-w-[1240px] px-3 py-5 sm:px-6 sm:py-7 xl:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-secondary">
            Personal workspace
          </p>
          <h1
            className="mt-1 text-2xl font-black sm:text-3xl"
          >
            Today
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            A bounded view of the relationships that matter now.
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          {pendingQuests > 0 ? (
            <a
              href="#quests-heading"
              className="flex min-h-11 items-center gap-2 rounded-lg border border-secondary/40 px-3 text-sm font-bold text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary"
            >
              <span
                className="material-symbols-outlined text-[19px]"
                aria-hidden="true"
              >
                military_tech
              </span>
              {pendingQuests} open {pendingQuests === 1 ? "quest" : "quests"}
            </a>
          ) : null}
          <Link
            href="/dashboard/approvals?status=pending"
            className="flex min-h-11 items-center gap-2 rounded-lg border border-outline-variant/40 px-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span
              className="material-symbols-outlined text-[19px]"
              aria-hidden="true"
            >
              approval
            </span>
            {approvals.status === "ready"
              ? `${pendingApprovals} pending approvals`
              : "Approvals"}
          </Link>
        </div>
      </header>

      {reminderReceipt ? (
        <section
          role="status"
          aria-live="polite"
          className="mb-6 border-y border-tertiary/40 bg-tertiary/5 px-3 py-4"
        >
          <h2
            ref={reminderReceiptFocusRef}
            tabIndex={-1}
            className="text-base font-black text-tertiary"
          >
            Reminder created
          </h2>
          <p className="mt-1 text-sm font-bold text-on-surface">
            {reminderReceipt.contact.name}
          </p>
          <p className="mt-1 text-sm text-on-surface-variant">
            {{
              birthday: "Birthday",
              followup: "Follow-up",
              anniversary: "Anniversary",
              custom: "Custom",
            }[reminderReceipt.type]}{" "}
            · {reminderReceipt.title}
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Scheduled {formatBriefDate(reminderReceipt.scheduledAt, reminderReceipt.timeZone)}
          </p>
        </section>
      ) : null}

      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,.8fr)]">
        <div className="min-w-0">
          {brief.status === "loading" ? (
            <LoadingLines label="Loading today's brief" />
          ) : null}
          {brief.status === "not-ready" ? (
            <section className="border-y border-outline-variant/25 py-8">
              <h2 className="text-lg font-black">
                Today’s brief is ready to build
              </h2>
              <p className="mt-2 text-sm text-on-surface-variant">
                Generate a durable recommendation set from your current CRM
                data.
              </p>
              <button
                type="button"
                disabled={generating}
                onClick={() => void generateBrief()}
                className="mt-4 min-h-11 rounded-lg bg-primary px-4 text-sm font-black text-on-primary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary"
              >
                {generating ? "Generating…" : "Generate today's brief"}
              </button>
            </section>
          ) : null}
          {brief.status === "error" ? (
            <PanelFailure message={brief.message} onRetry={() => loadBrief()} />
          ) : null}
          {brief.status === "ready" ? (
            <BriefFocusList
              brief={brief.data}
              busyItemId={busyItemId}
              itemErrors={itemErrors}
              onKeep={(itemId) => submitFeedback(itemId, { action: "accept" })}
              onSnooze={(itemId, snoozedUntil) =>
                submitFeedback(itemId, {
                  action: "snooze",
                  snoozedUntil,
                })
              }
              onDismiss={(itemId, reason) =>
                submitFeedback(
                  itemId,
                  reason ? { action: "dismiss", reason } : { action: "dismiss" }
                )
              }
              onReminder={(draft, trigger) => {
                reminderTriggerRef.current = trigger;
                setReminderDraft(draft);
              }}
            />
          ) : null}
        </div>

        <aside className="min-w-0 space-y-5" aria-label="Today utilities">
          {momentum === "loading" ? (
            <LoadingLines label="Loading momentum" />
          ) : null}
          {momentum === "unavailable" ? (
            <PanelFailure
              message={
                streak.status === "error"
                  ? streak.message
                  : "Could not load momentum."
              }
              onRetry={() => {
                void refreshDashboardStats().catch(() => undefined);
                loadStreak();
              }}
            />
          ) : null}
          {momentum === "ready" &&
          user &&
          stats &&
          streak.status === "ready" ? (
            <MomentumSummary
              level={user.level}
              xpProgress={stats.xpProgress}
              xpNeeded={stats.xpNeeded}
              streak={streak.data}
            />
          ) : null}
          {questReceipt ? (
            <section
              role="status"
              aria-live="polite"
              className="border-t border-secondary/40 bg-secondary/5 px-3 py-4"
            >
              <h2
                ref={questReceiptFocusRef}
                tabIndex={-1}
                className="text-base font-black text-secondary"
              >
                Quest verified
              </h2>
              <p className="mt-1 text-sm font-bold text-on-surface">
                {questReceipt.title}
              </p>
              <p className="mt-1 text-sm text-on-surface-variant">
                {questReceipt.evidenceType === "interaction"
                  ? "Interaction"
                  : "Reminder"}{" "}
                evidence verified
              </p>
              <p className="mt-1 text-sm font-black text-secondary">
                +{questReceipt.xpAwarded} XP awarded
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">
                Verified {formatBriefDate(questReceipt.verifiedAt, questReceipt.timeZone)}
              </p>
            </section>
          ) : null}
          {questInteractionReceipt ? (
            <InteractionReceipt
              receipt={questInteractionReceipt}
              detail="compact"
              live={false}
            />
          ) : null}
          {brief.status === "ready" ? (
            <QuestList
              quests={brief.data.quests}
              onOpen={(quest, trigger) => {
                questTriggerRef.current = trigger;
                setQuestReceipt(null);
                setQuestInteractionReceipt(null);
                setSelectedQuest(quest);
              }}
            />
          ) : null}
          {reminders.status === "loading" ? (
            <LoadingLines label="Loading reminders" />
          ) : null}
          {reminders.status === "error" ? (
            <PanelFailure
              message={reminders.message}
              onRetry={() => loadReminders()}
            />
          ) : null}
          {reminders.status === "ready" ? (
            <ReminderList
              data={reminders.data}
              timeZone={timeZone}
              busyId={busyReminderId}
              errors={reminderErrors}
              onComplete={completeReminder}
            />
          ) : null}
          <section
            aria-labelledby="approval-summary-heading"
            className="border-t border-outline-variant/25 pt-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id="approval-summary-heading"
                className="text-base font-black"
              >
                Agent approvals
              </h2>
              <Link
                href="/dashboard/approvals"
                className="min-h-11 py-3 text-xs font-bold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                View history
              </Link>
            </div>
            {approvals.status === "loading" ? (
              <LoadingLines label="Loading approvals" />
            ) : null}
            {approvals.status === "error" ? (
              <PanelFailure
                message={approvals.message}
                onRetry={() => loadApprovals()}
              />
            ) : null}
            {approvals.status === "ready" ? (
              <p className="mt-2 text-sm text-on-surface-variant">
                {pendingApprovals
                  ? `${pendingApprovals} proposal${pendingApprovals === 1 ? "" : "s"} need a decision.`
                  : "No proposals need a decision."}
              </p>
            ) : null}
          </section>
        </aside>
      </div>
      {reminderDraft ? (
        <ReminderDialog
          draft={reminderDraft}
          onClose={() => closeReminderDialog()}
          onSuccess={(receipt) => {
            setReminderReceipt(receipt);
            closeReminderDialog("receipt");
            loadReminders();
            void refreshUpcomingReminders().catch(() => undefined);
          }}
        />
      ) : null}
      {selectedQuest ? (
        <QuestCompletionDialog
          quest={selectedQuest}
          onClose={closeQuestDialog}
          onSuccess={(receipt, interactionReceipt) => {
            setQuestReceipt({ ...receipt, timeZone });
            setQuestInteractionReceipt(interactionReceipt);
            void refreshQuestData();
          }}
        />
      ) : null}
    </main>
  );
}
