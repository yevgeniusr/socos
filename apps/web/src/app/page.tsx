import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0b1326] text-[#dae2fd]">
      {/* Top Navigation Bar */}
      <nav className="fixed top-0 w-full z-50 glass-nav">
        <div className="flex justify-between items-center px-8 py-4 max-w-7xl mx-auto">
          <div className="text-2xl font-black tracking-tighter text-[#c0c1ff]" style={{ fontFamily: 'Manrope, sans-serif' }}>SOCOS</div>
          <div className="hidden md:flex items-center gap-8">
            <a className="text-sm font-semibold text-[#c0c1ff] border-b-2 border-[#c0c1ff] pb-1 transition-all" href="#features">Features</a>
            <a className="text-sm font-semibold text-[#dae2fd]/70 hover:text-[#c0c1ff] hover:opacity-100 transition-all" href="#pricing">Pricing</a>
            <a className="text-sm font-semibold text-[#dae2fd]/70 hover:text-[#c0c1ff] hover:opacity-100 transition-all" href="https://github.com/nanachichan3/socos" target="_blank">Open Source</a>
          </div>
          <Link href="/dashboard">
            <button className="bg-gradient-to-r from-[#c0c1ff] to-[#8083ff] text-[#0b1326] px-5 py-2 rounded-xl font-bold text-sm hover:brightness-110 transition-all active:scale-95">
              Get Started
            </button>
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative px-8 py-32 md:py-48 overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-2/3 bg-[radial-gradient(circle,rgba(192,193,255,0.08)_0%,rgba(11,19,38,0)_70%)] z-[-1]" />
        <div className="max-w-5xl mx-auto text-center">
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 leading-[1.1]" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Your Personal Relationship <br />
            <span className="text-gradient">Operating System.</span>
          </h1>
          <p className="text-[#c7c4d7] text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            A gamified, AI-first personal CRM that helps you build deeper connections through automation and social rewards.
          </p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
            <Link href="/dashboard">
              <button className="w-full sm:w-auto px-10 py-4 bg-gradient-to-r from-[#c0c1ff] to-[#8083ff] text-[#0b1326] rounded-xl font-extrabold text-base shadow-lg shadow-primary/10 hover:brightness-110 transition-all">
                Get Started for Free
              </button>
            </Link>
            <a href="#demo" className="w-full sm:w-auto px-10 py-4 bg-[#171f33] text-[#c0c1ff] rounded-xl font-bold text-base hover:bg-[#222a3d] transition-all flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Watch Demo
            </a>
          </div>
        </div>

        {/* Dashboard Preview */}
        <div className="mt-20 max-w-6xl mx-auto relative group">
          <div className="absolute inset-0 bg-[#c0c1ff]/20 blur-[100px] rounded-full opacity-20 group-hover:opacity-30 transition-opacity" />
          <div className="bg-[#131b2e] p-2 rounded-2xl border border-[#464554]/15 shadow-2xl relative overflow-hidden">
            <div className="bg-[#0b1326] rounded-xl overflow-hidden">
              {/* Fake browser chrome */}
              <div className="flex items-center gap-2 px-4 py-3 bg-[#171f33] border-b border-[#464554]/15">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                  <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex-1 mx-4 bg-[#0b1326] rounded-md px-3 py-1 text-[10px] text-[#908fa0]">
                  socos.rachkovan.com/dashboard
                </div>
              </div>
              {/* Fake dashboard content */}
              <div className="p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <div className="space-y-1">
                    <div className="h-4 w-32 bg-[#222a3d] rounded-md" />
                    <div className="h-3 w-48 bg-[#222a3d]/60 rounded-md" />
                  </div>
                  <div className="h-8 w-8 bg-[#c0c1ff]/20 rounded-full" />
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {[1,2,3,4].map(i => <div key={i} className="h-16 bg-[#131b2e] border border-[#464554]/10 rounded-xl" />)}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {[1,2,3].map(i => <div key={i} className="h-12 bg-[#131b2e] border border-[#464554]/10 rounded-xl" />)}
                  </div>
                  <div className="space-y-2">
                    {[1,2,3].map(i => <div key={i} className="h-12 bg-[#131b2e] border border-[#464554]/10 rounded-xl" />)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="py-12 border-t border-[#464554]/10">
        <div className="max-w-7xl mx-auto px-8 flex flex-wrap justify-center items-center gap-12 opacity-50">
          {['OPEN SOURCE', 'PRIVACY FIRST', 'SELF HOSTABLE', 'AGENT POWERED'].map(s => (
            <span key={s} className="text-xs font-extrabold tracking-widest text-[#c0c1ff]" style={{ fontFamily: 'Manrope, sans-serif' }}>{s}</span>
          ))}
        </div>
      </section>

      {/* Public Demo */}
      <section id="demo" className="py-20 px-8 bg-[#0b1326] border-y border-[#464554]/10 scroll-mt-24">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-10">
            <div>
              <span className="inline-block text-xs font-extrabold tracking-widest text-[#c0c1ff] uppercase mb-4 px-4 py-1.5 bg-[#c0c1ff]/10 rounded-full">
                Private alpha proof
              </span>
              <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
                What Socos will show before an agent contacts anyone.
              </h2>
              <p className="text-[#c7c4d7] max-w-2xl text-base md:text-lg leading-relaxed">
                The live product is invite-only while Yev imports his Monica archive and connects Hermes, Calendar, and Pixel. This sample shows the intended daily cockpit without exposing real contacts.
              </p>
            </div>
            <Link href="/auth/signup" className="shrink-0">
              <button className="w-full lg:w-auto bg-[#c0c1ff] text-[#0b1326] px-8 py-3 rounded-xl font-extrabold hover:brightness-110 transition-all">
                Request invite access
              </button>
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6">
            <div className="bg-[#131b2e] border border-[#464554]/20 rounded-2xl p-6">
              <div className="flex items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="font-extrabold text-xl" style={{ fontFamily: 'Manrope' }}>Daily social brief</h3>
                  <p className="text-sm text-[#908fa0]">Sample data, real workflow shape</p>
                </div>
                <span className="text-xs font-extrabold text-[#4edea3] bg-[#4edea3]/10 px-3 py-1 rounded-full">No outbound actions</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {[
                  { label: 'Important date', value: 'Rizala birthday in 6 days', detail: 'Draft a warm note, do not send' },
                  { label: 'Reconnect', value: 'Alex has gone quiet', detail: 'Ask about the education research thread' },
                  { label: 'Event fit', value: 'Dubai AI founders salon', detail: 'Good for professional + social mix' },
                ].map((item) => (
                  <div key={item.label} className="bg-[#0b1326] border border-[#464554]/15 rounded-xl p-4">
                    <div className="text-[10px] uppercase tracking-widest text-[#908fa0] font-extrabold mb-2">{item.label}</div>
                    <div className="text-sm font-bold text-[#dae2fd] mb-2">{item.value}</div>
                    <div className="text-xs text-[#c7c4d7] leading-relaxed">{item.detail}</div>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                {[
                  ['Quest', 'Send one voice memo to a warm friend', '+25 XP after you log it yourself'],
                  ['Memory', 'Met through Self-Degree founder circle', 'Source preserved, editable later'],
                  ['Approval', 'Hermes wants to suggest an intro', 'Requires human approval before sending'],
                ].map(([type, title, detail]) => (
                  <div key={title} className="flex items-center gap-4 bg-[#0b1326] border border-[#464554]/15 rounded-xl p-4">
                    <div className="w-12 h-12 rounded-xl bg-[#c0c1ff]/10 flex items-center justify-center text-[#c0c1ff] text-xs font-black">
                      {type.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm">{title}</div>
                      <div className="text-xs text-[#908fa0]">{detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-[#131b2e] border border-[#464554]/20 rounded-2xl p-6">
                <h3 className="font-extrabold text-lg mb-4" style={{ fontFamily: 'Manrope' }}>What is live now</h3>
                <div className="space-y-3">
                  {[
                    'Monica import path for 106 contacts into the Coolify database',
                    'Authenticated MCP/API tools for briefs, contacts, reminders, quests, and approved actions',
                    'Calendar, Pixel location, and public event modules deployed disabled-first',
                    'Deletion, encryption, rekey, audit, and backup runbooks for personal data',
                  ].map((item) => (
                    <div key={item} className="flex gap-3 text-sm text-[#c7c4d7] leading-relaxed">
                      <span className="mt-1 h-2 w-2 rounded-full bg-[#4edea3] shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#131b2e] border border-[#464554]/20 rounded-2xl p-6">
                <h3 className="font-extrabold text-lg mb-4" style={{ fontFamily: 'Manrope' }}>Safety boundaries</h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {[
                    'Read and summarize automatically',
                    'Log safe interactions',
                    'Suggest events and people',
                    'Approval required for messages',
                    'Approval required for intros',
                    'Approval required for deletes',
                  ].map((item) => (
                    <div key={item} className="bg-[#0b1326] border border-[#464554]/15 rounded-lg p-3 text-[#dae2fd]">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Solo-Consultants High-Conversion Section */}
      <section className="py-20 px-8 bg-[#060e20] relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(78,222,163,0.04)_0%,rgba(11,19,38,0)_70%)]" />
        <div className="max-w-7xl mx-auto relative">
          {/* Header */}
          <div className="text-center mb-14">
            <span className="inline-block text-xs font-extrabold tracking-widest text-[#4edea3] uppercase mb-4 px-4 py-1.5 bg-[#4edea3]/10 rounded-full">
              Solo-Consultants
            </span>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Your clients don't forget.
              <br />
              <span className="text-[#4edea3]">Your system should.</span>
            </h2>
            <p className="text-[#c7c4d7] max-w-2xl mx-auto text-lg">
              You're not losing clients because you don't care. You're losing them because you have no system that works as fast as you do. SOCOS fixes that.
            </p>
          </div>

          {/* Pain → Solution Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
            {[
              {
                pain: "You met 3 new clients this week. By Friday, you can't remember their dog's name.",
                solve: "SOCOS auto-logs every interaction. Every detail. Every promise. Searchable in seconds.",
                icon: "🧠",
              },
              {
                pain: "Your follow-up system is a spreadsheet you check when you remember.",
                solve: "SOCOS AI surfaces exactly who needs a touchpoint today — and drafts the message for you.",
                icon: "🤖",
              },
              {
                pain: "You're billing hourly but bleeding revenue on admin work.",
                solve: "SOCOS handles contact maintenance automatically. You focus on the work that earns.",
                icon: "⚡",
              },
            ].map(({ pain, solve, icon }, i) => (
              <div key={i} className="bg-[#0b1326] border border-[#464554]/20 rounded-2xl p-7 hover:border-[#4edea3]/30 transition-all">
                <div className="text-3xl mb-4">{icon}</div>
                <p className="text-[#ffb4ab] text-sm font-medium mb-4 leading-relaxed">{pain}</p>
                <p className="text-[#4edea3] text-sm font-semibold leading-relaxed">{solve}</p>
              </div>
            ))}
          </div>

          {/* Feature callouts for consultants */}
          <div className="bg-[#131b2e] rounded-2xl border border-[#464554]/20 p-8 mb-10">
            <h3 className="text-xl font-extrabold mb-6 text-center" style={{ fontFamily: 'Manrope' }}>
              Built for the way you actually work
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { icon: "📊", label: "Revenue tracking", sub: "Log calls, meetings, deals" },
                { icon: "🔗", label: "Client context", sub: "How you met, history at a glance" },
                { icon: "📅", label: "Touchpoint reminders", sub: "Never miss a re-engagement" },
                { icon: "📤", label: "Client updates", sub: "Auto-draft status check-ins" },
              ].map(({ icon, label, sub }, i) => (
                <div key={i} className="flex flex-col items-center text-center p-4 rounded-xl bg-[#0b1326] hover:bg-[#171f33] transition-colors">
                  <div className="text-2xl mb-2">{icon}</div>
                  <div className="text-sm font-bold text-[#c0c1ff] mb-1">{label}</div>
                  <div className="text-xs text-[#908fa0]">{sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex flex-wrap justify-center gap-8 md:gap-16 mb-10">
            {[
              { stat: "< 30s", label: "to log a client interaction" },
              { stat: "3x", label: "more consistent follow-ups" },
              { stat: "0", label: "spreadsheets required" },
            ].map(({ stat, label }, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl font-extrabold text-[#4edea3] mb-1" style={{ fontFamily: 'Manrope' }}>{stat}</div>
                <div className="text-xs text-[#908fa0] uppercase tracking-widest font-semibold">{label}</div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="text-center">
            <p className="text-[#c7c4d7] mb-6 text-base">
              Stop losing deals to bad memory. Your pipeline deserves a real system.
            </p>
            <Link href="/dashboard">
              <button className="bg-gradient-to-r from-[#4edea3] to-[#3bc98a] text-[#0b1326] px-10 py-4 rounded-xl font-extrabold text-base shadow-lg shadow-[#4edea3]/20 hover:brightness-110 transition-all">
                Get Started Free — No Credit Card
              </button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Bento Grid */}
      <section id="features" className="py-24 px-8 bg-[#060e20]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>Master Your Network</h2>
            <p className="text-[#c7c4d7] max-w-xl mx-auto">Intelligence that feels human. Rewards that keep you engaged.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: '🤖',
                title: 'Agent-First Intelligence',
                desc: 'AI agents that proactively manage your outreach, drafting personalized messages and finding the perfect time to reconnect.',
                accent: '#c0c1ff',
                gradient: 'from-[#c0c1ff]/10 to-transparent',
                border: 'hover:border-[#c0c1ff]/30',
              },
              {
                icon: '🎮',
                title: 'Gamified Social Growth',
                desc: 'Level up your relationships and earn XP for staying connected. Unlock badges and streaks as you master the art of networking.',
                accent: '#4edea3',
                gradient: 'from-[#4edea3]/10 to-transparent',
                border: 'hover:border-[#4edea3]/30',
                badge: { text: 'LEVEL 14', subtext: '850 / 1000 XP', pct: 85, color: '#4edea3' },
              },
              {
                icon: '🔒',
                title: 'Privacy-First Architecture',
                desc: 'Open-source and self-hostable. Your contact data never leaves your infrastructure unless you want it to.',
                accent: '#908fa0',
                gradient: 'from-[#908fa0]/10 to-transparent',
                border: 'hover:border-[#908fa0]/30',
              },
            ].map((f, i) => (
              <div key={i} className={`bg-gradient-to-br ${f.gradient} p-8 rounded-2xl border border-[#464554]/10 ${f.border} transition-all group`}>
                <div className="text-4xl mb-6">{f.icon}</div>
                <h3 className="text-xl font-extrabold mb-4" style={{ fontFamily: 'Manrope' }}>{f.title}</h3>
                <p className="text-[#c7c4d7] leading-relaxed text-sm">{f.desc}</p>
                {f.badge && (
                  <div className="mt-6 space-y-2">
                    <div className="flex justify-between text-[10px] font-extrabold uppercase tracking-widest" style={{ color: f.badge.color }}>
                      <span>{f.badge.text}</span>
                      <span>{f.badge.subtext}</span>
                    </div>
                    <div className="w-full h-1 bg-[#222a3d] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${f.badge.pct}%`, backgroundColor: f.badge.color, boxShadow: `0 0 8px ${f.badge.color}` }} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 px-8 overflow-hidden">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
          <div>
            <h2 className="text-4xl font-extrabold mb-8 tracking-tight" style={{ fontFamily: 'Manrope' }}>
              Designed for the <span className="text-[#c0c1ff]">Curator</span> in you.
            </h2>
            <div className="space-y-8">
              {[
                { n: 1, title: 'Connect Your Network', desc: 'Import from LinkedIn, Email, and Calendar with one click. Socos builds your initial graph in seconds.' },
                { n: 2, title: 'Let Soco Agent Handle the Rest', desc: 'Your agent identifies "weak ties" and suggests low-friction ways to add value to your connections.' },
                { n: 3, title: 'Level Up Your Social Skills', desc: "Watch your social score grow as you maintain consistent, meaningful interactions without the burnout." },
              ].map(step => (
                <div key={step.n} className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#c0c1ff]/20 flex items-center justify-center text-[#c0c1ff] font-extrabold text-sm">{step.n}</div>
                  <div>
                    <h4 className="font-extrabold mb-1" style={{ fontFamily: 'Manrope' }}>{step.title}</h4>
                    <p className="text-sm text-[#c7c4d7]">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="absolute -top-10 -left-10 w-64 h-64 bg-[#c0c1ff]/10 rounded-full blur-3xl" />
            <div className="bg-[#131b2e] rounded-2xl overflow-hidden shadow-2xl rotate-2 hover:rotate-0 transition-transform duration-500 border border-[#464554]/15">
              <div className="p-6 space-y-3">
                {[
                  { color: '#4edea3', name: 'Sarah Jenkins', title: 'Product Lead @ Anthropic', score: 88 },
                  { color: '#ffb4ab', name: 'Marcus Wright', title: 'VC Associate @ Index', score: 24 },
                  { color: '#4edea3', name: 'Elena Rodriguez', title: 'Founder @ Bloom', score: 72 },
                ].map((c, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-[#0b1326] rounded-xl">
                    <div className="w-10 h-10 rounded-lg bg-[#222a3d] flex items-center justify-center text-sm font-bold">{c.name[0]}</div>
                    <div className="flex-1">
                      <div className="font-bold text-sm">{c.name}</div>
                      <div className="text-[10px] text-[#908fa0]">{c.title}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-extrabold" style={{ color: c.color }}>{c.score}</div>
                      <div className="text-[8px] text-[#908fa0]">health</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute -bottom-10 -right-10 w-64 h-64 bg-[#4edea3]/10 rounded-full blur-3xl" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="pricing" className="py-24 px-8">
        <div className="max-w-4xl mx-auto bg-[#131b2e] rounded-[2rem] p-12 md:p-20 text-center relative overflow-hidden border border-[#464554]/10">
          <div className="absolute inset-0 bg-gradient-to-br from-[#c0c1ff]/5 to-[#4edea3]/5" />
          <div className="relative z-10">
            <h2 className="text-4xl md:text-5xl font-extrabold mb-6" style={{ fontFamily: 'Manrope' }}>Ready to upgrade your social life?</h2>
            <p className="text-[#c7c4d7] text-lg mb-10 max-w-xl mx-auto">Join thousands of early curators building the future of social intelligence.</p>
            <Link href="/dashboard">
              <button className="bg-gradient-to-r from-[#c0c1ff] to-[#8083ff] text-[#0b1326] px-10 py-4 rounded-xl font-extrabold text-base hover:brightness-110 transition-all">
                Start Building Your Network
              </button>
            </Link>
            <p className="mt-6 text-xs text-[#908fa0]/60 uppercase tracking-widest font-extrabold">No Credit Card Required • Privacy Guaranteed</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#060e20] border-t border-[#464554]/15">
        <div className="max-w-7xl mx-auto py-12 px-8 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-lg font-extrabold text-[#c0c1ff]" style={{ fontFamily: 'Manrope' }}>SOCOS</div>
          <div className="flex flex-wrap justify-center gap-8">
            {['GitHub', 'Discord', 'Privacy Policy', 'Terms of Service'].map(l => (
              <a key={l} href="#" className="text-[#c7c4d7] hover:text-[#c0c1ff] transition-colors text-sm">{l}</a>
            ))}
          </div>
          <p className="text-[#c7c4d7] text-sm">© 2026 SOCOS. The Digital Curator.</p>
        </div>
      </footer>
    </main>
  );
}
