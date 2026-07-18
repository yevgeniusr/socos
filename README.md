# SOCOS — Your Relationships, Leveled Up

> **The personal CRM that treats relationships like the skill they are.**
> Gamified. Agent-first. Self-hosted. Built for people who actually want to show up for the humans in their lives.

[![MIT License](https://img.shields.io/github/license/rachkovan/socos?style=flat-square)](LICENSE)
[![Build Status](https://img.shields.io/github/actions/workflow/status/rachkovan/socos/ci.yml?style=flat-square)](https://github.com/rachkovan/socos/actions)
[![Open Issues](https://img.shields.io/github/issues-raw/rachkovan/socos?style=flat-square)](https://github.com/rachkovan/socos/issues)
[![Stars](https://img.shields.io/github/stars/rachkovan/socos?style=flat-square)](https://github.com/rachkovan/socos/stargazers)
[![Discord](https://img.shields.io/badge/Discord-SOCOS-blue?style=flat-square&logo=discord)](https://discord.gg/rachkovan)

[🌐 socos.rachkovan.com](https://socos.rachkovan.com) · [🐙 GitHub](https://github.com/rachkovan/socos) · [📖 Docs](#)

---

## Try It Out

![SOCOS Dashboard](docs/socos-dashboard.png)

_A glimpse of the SOCOS dashboard — contact list, gamification stats, and relationship tracking all in one place._

---

## The Hook

You meet someone great. You mean to stay in touch. Three months later you realize you have no idea what happened to them.

SOCOS is the personal CRM that **actively works** to keep your relationships alive — not just a database you have to update manually. AI agents track who you should reconnect with, when, and why. You earn XP for showing up. Your relationships have levels. Streaks track your consistency.

It's Notion for relationships meets a personal AI assistant — **self-hosted, privacy-first, and open source.**

---

## Why SOCOS?

| | Monica | Twenty | **SOCOS** |
|---|---|---|---|
| AI Agents that proactively remind you | ❌ | ⚠️ Basic | ✅ Full automation |
| Gamification (XP, levels, streaks) | ❌ | ❌ | ✅ Built in |
| Built for individuals, not sales teams | ✅ | ❌ | ✅ |
| API-first (built for agents) | ❌ | ⚠️ | ✅ |
| Self-hosted | ✅ | ✅ | ✅ |
| Birthday/celebration reminders | ⚠️ | ⚠️ | ✅ + lunar calendar support |

SOCOS is the only personal CRM that combines **AI agents + gamification + full API access** in one self-hosted package. If you want a CRM that works *for* you — not just stores data — this is it.

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/rachkovan/socos.git
cd socos

# 2. Install dependencies
pnpm install

# 3. Start everything with Docker (Postgres + API + Web)
docker-compose up -d

# 4. Open the app
open http://localhost:3000
```

**That's it.** No external services, no API keys needed for local dev.

For manual setup (without Docker), see [docs/QUICK_START.md](docs/QUICK_START.md).

---

## Tech Stack

```
Frontend   Next.js 14 (React, TypeScript)
Backend    NestJS (Node.js, TypeScript)
Database   PostgreSQL + Prisma ORM
Auth       NextAuth.js
AI/Agents  LangChain + OpenAI / Anthropic
API        REST + GraphQL
Infra      Docker, pnpm workspaces
```

---

## Architecture

```
socos/
├── apps/
│   └── web/                 # Next.js 14 — the UI
├── services/
│   └── nestjs-service/     # NestJS — API & business logic
├── packages/
│   ├── database/           # Prisma schema + client
│   ├── api-client/         # Typed API client for agents
│   ├── ui/                 # Shared UI components
│   └── agent-core/         # AI agent framework
└── docker-compose.yaml     # One command to spin up everything
```

---

## The AI Agent System

SOCOS ships with agents that do the tedious work so you can do the human work.

**Relationship Agent**
> *"Hey, you haven't talked to Alex in 3 weeks. Want to send a quick note?"*

**Reminder Agent**
> *"Sarah's birthday is tomorrow. Want to set a reminder to call?"*

**Enrichment Agent**
> Builds provenance-backed field candidates from explicitly supplied sources.
> Missing fields can be filled safely; populated fields and ambiguous identities
> are never silently overwritten or guessed. See
> [the enrichment operator guide](docs/contact-enrichment.md).

**Summary Agent**
> Paste meeting notes → get a structured interaction log automatically.

---

## Gamification

Every intentional action earns XP. Your relationships have a level. Your consistency has a streak.

| Action | XP |
|---|---|
| Log a contact | +10 |
| Log an interaction | +15 |
| Complete reminder on time | +20 |
| Maintain a 7-day streak | +50 |
| Maintain a 30-day streak | +150 |
| Unlock an achievement | +100 |

**First achievements to unlock:**
- 🌱 **First Contact** — Add your first contact
- 🔥 **Streak Starter** — Complete reminders on time 3 days in a row
- 🎯 **Active Networker** — Log 10 interactions in a week
- 👑 **Relationship Master** — Maintain a 90-day streak

The goal isn't a high score. The goal is a **longer streak** — meaning a more consistent, more intentional practice of showing up for people.

---

## Why Self-Hosted?

Because your relationship data is some of the most personal data you have.

When your CRM is a SaaS product, your relationship network becomes someone else's data asset. SOCOS runs on your infrastructure — your laptop, your server, your VPS. Your contacts, your notes, your history. No vendor lock-in. No data harvesting. MIT license.

---

## Contributing

Contributions are welcome — bug reports, feature requests, docs, code.

```bash
# Run tests
pnpm test

# TypeScript type check
pnpm type:check

# Lint
pnpm lint
```

Open an issue or PR on [GitHub](https://github.com/rachkovan/socos/issues). For major changes, please open an issue first to discuss what you'd like to change.

See also: [CONTRIBUTING.md](CONTRIBUTING.md)

---

## License

MIT — See [LICENSE](LICENSE)

---

**Built with intention for people who care about showing up.**
[🌐 socos.rachkovan.com](https://socos.rachkovan.com)
