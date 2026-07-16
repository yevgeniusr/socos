import type { StreakResponse } from "@/lib/cockpit-contracts";

export default function MomentumSummary({ level, xpProgress, xpNeeded, streak }: { level: number; xpProgress: number; xpNeeded: number; streak: StreakResponse | null }) {
  const percentage = xpNeeded > 0 ? Math.min(100, Math.round((xpProgress / xpNeeded) * 100)) : 0;
  return (
    <section aria-labelledby="momentum-heading">
      <h2 id="momentum-heading" className="text-base font-black">Momentum</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-3">
          <p className="text-xs text-on-surface-variant">Level</p><p className="mt-1 text-2xl font-black text-primary">{level}</p>
        </div>
        <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-3">
          <p className="text-xs text-on-surface-variant">Streak</p><p className="mt-1 text-2xl font-black text-secondary">{streak?.streakDays ?? 0}</p>
        </div>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-xs text-on-surface-variant"><span>XP progress</span><span>{xpProgress}/{xpNeeded}</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-container-highest"><div className="h-full bg-secondary" style={{ width: `${percentage}%` }} /></div>
      </div>
      {streak?.streakAtRisk ? <p className="mt-3 text-xs font-bold text-tertiary-fixed-dim">Your streak is at risk today.</p> : null}
    </section>
  );
}
