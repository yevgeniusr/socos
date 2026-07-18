# SOCOS AI Agent System

**Status:** Implemented  
**Date:** 2026-04-26  
**CTO:** Implemented as part of CTO work session

---

## Overview

The SOCOS AI Agent system is a multi-agent architecture where each agent has a specific responsibility in helping users manage their relationships proactively.

## Agent Roles

| Agent | Responsibility | Key Methods |
|-------|---------------|-------------|
| **Relationship Agent** | Tracks contacts needing attention based on interaction frequency and relationship score | `getRecommendations()`, `refreshScores()` |
| **Reminder Agent** | Handles birthday, anniversary, follow-up, and stale contact reminders | `getUpcomingReminders()`, `syncCelebrationReminders()` |
| **Enrichment Agent** | Reports completeness; evidence-backed changes use the scoped MCP candidate ledger | `socos_contacts_missing_enrichment`, `socos_enrichment_candidate_submit` |
| **Summary Agent** | Generates AI summaries of interactions and contact history | `summarizeInteraction()`, `summarizeContactHistory()` |
| **Suggestion Agent** | Recommends people to meet based on interests and patterns | `getSuggestions()`, `suggestIntroductions()` |

## Architecture

```
AgentsController (HTTP API layer)
    ↓
AgentsService (Orchestrator / Router)
    ├── RelationshipAgent
    ├── ReminderAgent
    ├── EnrichmentAgent
    ├── SummaryAgent
    └── SuggestionAgent
    ↓
PrismaService (Database access)
```

## API Endpoints

All endpoints require `X-User-Id` header.

### Relationship Agent

```
GET  /api/agents/relationship                    # Get contacts needing attention
POST /api/agents/relationship/refresh-scores    # Refresh all relationship scores
```

### Reminder Agent

```
GET  /api/agents/reminders/upcoming             # Get upcoming reminders
GET  /api/agents/reminders/birthdays            # Get birthday reminders
GET  /api/agents/reminders/stale                # Get stale contact reminders
POST /api/agents/reminders/sync-celebrations    # Sync celebrations to reminders
```

### Enrichment Agent

```
POST /api/agents/enrich/:contactId              # Enrich single contact
POST /api/agents/enrich/batch                    # Batch enrich contacts
POST /api/agents/enrich/:contactId/apply         # Disabled legacy direct-write route
```

### Summary Agent

```
GET  /api/agents/summary/interaction/:id         # Summarize single interaction
GET  /api/agents/summary/contact/:id             # Summarize contact history
GET  /api/agents/summary/activity               # Weekly/monthly activity summary
```

### Suggestion Agent

```
GET  /api/agents/suggestions                     # Get suggested contacts to meet
GET  /api/agents/suggestions/introductions      # Get warm introduction suggestions
GET  /api/agents/suggestions/score-improvement  # Get contacts to improve scores
```

### Dashboard

```
GET  /api/agents/dashboard                       # Get full agent dashboard data
```

## Environment Variables

```env
# OpenAI API for AI-powered features (summaries, enrichment in production)
OPENAI_API_KEY="sk-..."

# Anthropic API (optional - for longer context)
ANTHROPIC_API_KEY="sk-ant-..."

```

## Future Enhancements

1. **Human candidate review UI**: Review and decide pending public-web enrichment evidence
2. **Agent Memory**: Each agent could have a memory of past actions to improve recommendations
3. **Scheduled Agents**: Run agents on a cron schedule (e.g., reminder agent daily)
4. **Multi-Agent Coordination**: Agents could communicate (e.g., enrichment agent → summary agent)
5. **User Feedback Loop**: Users can rate agent suggestions to improve them over time

## Relationship Score Algorithm

```typescript
// Base score: 50
// +30 if last interaction within 7 days
// +20 if last interaction within 14 days
// +10 if last interaction within 30 days
// -5 per 30 days stale (max -30)
// +10 if 10+ lifetime interactions
// +5 if 5+ lifetime interactions
// Final score clamped to 0-100
```

## Files

```
services/api/src/modules/agents/
├── agents.module.ts              # NestJS module
├── agents.controller.ts          # HTTP API layer
├── agents.service.ts             # Orchestrator/router
├── agents/types.ts               # TypeScript types
└── strategies/
    ├── relationship-agent.ts      # Relationship tracking
    ├── reminder-agent.ts         # Reminder management
    ├── enrichment-agent.ts       # Contact enrichment
    ├── summary-agent.ts          # Interaction summarization
    └── suggestion-agent.ts        # Meeting suggestions
```
