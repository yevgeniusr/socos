import type { DailyBrief } from "@/lib/cockpit-contracts";

export default function QuestList({
  quests,
  onOpen,
}: {
  quests: DailyBrief["quests"];
  onOpen: (
    quest: DailyBrief["quests"][number],
    trigger: HTMLButtonElement
  ) => void;
}) {
  const pending = quests.filter((quest) => quest.status === "pending");
  return (
    <section
      aria-labelledby="quests-heading"
      className="border-t border-outline-variant/25 pt-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="quests-heading" className="text-base font-black">
          Verified quests
        </h2>
        <span className="text-xs font-bold text-secondary">
          {pending.length} open
        </span>
      </div>
      {pending.length ? (
        <ul className="mt-3 space-y-2">
          {pending.map((quest) => (
            <li
              key={quest.questId}
              className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="break-words text-sm font-bold">{quest.title}</p>
                <span className="shrink-0 text-xs font-black text-secondary">
                  +{quest.xpReward} XP
                </span>
              </div>
              <p className="mt-1 text-xs text-on-surface-variant">
                Requires verified {quest.completionType} evidence.
              </p>
              <button
                type="button"
                onClick={(event) => onOpen(quest, event.currentTarget)}
                className="mt-3 min-h-11 w-full rounded-lg border border-secondary/50 text-sm font-bold text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary"
              >
                Complete quest
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-on-surface-variant">No open quests.</p>
      )}
    </section>
  );
}
