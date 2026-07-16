import Link from 'next/link';

const workflow = [
  {
    step: 'Captured interaction',
    title: 'Met Maya after the Dubai AI builders salon',
    detail:
      'Hermes records that you discussed evaluation harnesses, family travel, and a promise to send the Socos MCP notes.',
    source: 'Discord summary + calendar attendance',
  },
  {
    step: 'AI memory extraction',
    title: 'Useful facts become editable relationship memory',
    detail:
      'Socos keeps the promise, preferred channel, context, and follow-up cadence separate from raw transcript text.',
    source: 'Needs review before permanent memory',
  },
  {
    step: 'Suggested next action',
    title: 'Send the MCP note before Thursday evening',
    detail:
      'The reminder is ranked above generic networking because there is a fresh commitment, a near-term date, and clear shared work.',
    source: 'No outbound action yet',
  },
  {
    step: 'Approval before outbound action',
    title: 'Hermes drafts, you approve',
    detail:
      'The agent can prepare the message and log your edits. It cannot send, introduce, invite, merge, or delete without approval.',
    source: 'Risk-based autonomy',
  },
];

const briefItems = [
  ['Important date', 'Rizala birthday in 6 days', 'Prepare a warm note and gift idea; no send action.'],
  ['Reconnect', 'Alex has gone quiet', 'Ask about the education research thread after checking calendar conflicts.'],
  ['Event fit', 'Dubai AI founders salon', 'Professional networking with a hobby/learning overlap.'],
  ['Social quest', 'One low-friction voice memo', '+25 XP after you send and log it yourself.'],
];

const controls = [
  'Export and delete personal data',
  'Rekey encrypted tokens and location samples',
  'Disable Calendar, Pixel, or event discovery independently',
  'Audit agent reads, writes, proposals, and approvals',
];

export default function SampleWorkspacePage() {
  return (
    <main className="min-h-screen bg-[#081225] text-[#dae2fd]">
      <nav className="border-b border-[#464554]/15 bg-[#081225]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-2xl font-black tracking-tighter text-[#c0c1ff]" style={{ fontFamily: 'Manrope, sans-serif' }}>
            SOCOS
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/#demo" className="hidden text-sm font-bold text-[#dae2fd]/70 hover:text-[#c0c1ff] sm:inline">
              Demo
            </Link>
            <Link href="/auth/signup" className="rounded-xl bg-[#c0c1ff] px-4 py-2 text-sm font-extrabold text-[#081225] hover:brightness-110">
              Request invite access
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:py-14">
        <div>
          <p className="mb-4 inline-flex rounded-full border border-[#4edea3]/20 bg-[#4edea3]/10 px-4 py-1.5 text-xs font-extrabold uppercase tracking-widest text-[#4edea3]">
            Read-only alpha preview
          </p>
          <h1 className="mb-5 text-4xl font-extrabold leading-tight tracking-tight md:text-6xl" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Sample relationship workspace
          </h1>
          <p className="max-w-3xl text-base leading-relaxed text-[#c7c4d7] md:text-lg">
            This is the core Socos loop with synthetic data: capture context, extract memory, rank the next useful action, and hold risky actions for approval.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <section className="rounded-2xl border border-[#464554]/20 bg-[#101a2f] p-5">
            <h2 className="mb-3 text-lg font-extrabold">Launch status and access</h2>
            <div className="space-y-3 text-sm text-[#c7c4d7]">
              <p>Private alpha for Yev first; public invites open after the personal workflow is reliable.</p>
              <p>Pricing is not active yet. Early access is free while the system is invite-gated.</p>
            </div>
          </section>
          <section className="rounded-2xl border border-[#464554]/20 bg-[#101a2f] p-5">
            <h2 className="mb-3 text-lg font-extrabold">Data controls</h2>
            <div className="space-y-2 text-sm text-[#c7c4d7]">
              {controls.map((control) => (
                <div key={control} className="rounded-xl border border-[#464554]/15 bg-[#081225] p-3">
                  {control}
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 pb-14 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-2xl border border-[#464554]/20 bg-[#101a2f] p-6">
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-2xl font-extrabold" style={{ fontFamily: 'Manrope, sans-serif' }}>
                Daily social brief
              </h2>
              <p className="text-sm text-[#908fa0]">Synthetic data, production workflow shape</p>
            </div>
            <span className="w-fit rounded-full bg-[#4edea3]/10 px-3 py-1 text-xs font-extrabold text-[#4edea3]">
              No outbound actions
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {briefItems.map(([label, title, detail]) => (
              <article key={title} className="rounded-xl border border-[#464554]/15 bg-[#081225] p-4">
                <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-[#908fa0]">{label}</p>
                <h3 className="mb-2 text-sm font-bold text-[#dae2fd]">{title}</h3>
                <p className="text-xs leading-relaxed text-[#c7c4d7]">{detail}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#464554]/20 bg-[#101a2f] p-6">
          <h2 className="mb-6 text-2xl font-extrabold" style={{ fontFamily: 'Manrope, sans-serif' }}>
            One complete relationship loop
          </h2>
          <div className="space-y-4">
            {workflow.map((item, index) => (
              <article key={item.step} className="grid grid-cols-[44px_1fr] gap-4 rounded-xl border border-[#464554]/15 bg-[#081225] p-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#c0c1ff]/10 text-sm font-black text-[#c0c1ff]">
                  {index + 1}
                </div>
                <div>
                  <p className="mb-1 text-xs font-extrabold uppercase tracking-widest text-[#4edea3]">{item.step}</p>
                  <h3 className="mb-2 text-base font-extrabold text-[#dae2fd]">{item.title}</h3>
                  <p className="mb-3 text-sm leading-relaxed text-[#c7c4d7]">{item.detail}</p>
                  <p className="text-xs font-bold text-[#908fa0]">{item.source}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[#464554]/15 bg-[#0b1326]">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-extrabold">Want access to the real workspace?</h2>
            <p className="mt-1 text-sm text-[#c7c4d7]">
              The account flow is invite-gated until the personal-first setup is stable.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/auth/signup" className="rounded-xl bg-[#c0c1ff] px-5 py-3 text-center text-sm font-extrabold text-[#081225] hover:brightness-110">
              Request invite access
            </Link>
            <Link href="/" className="rounded-xl border border-[#464554]/25 bg-[#101a2f] px-5 py-3 text-center text-sm font-bold text-[#dae2fd] hover:border-[#c0c1ff]/40">
              Back to Socos
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
