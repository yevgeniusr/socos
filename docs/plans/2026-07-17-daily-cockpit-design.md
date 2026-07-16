# Authenticated Daily Cockpit Design

**Date:** 2026-07-17

**Deployment:** Existing Socos web/API on Coolify; PostgreSQL remains the sole source of truth

## Goal

Turn the durable Social Brief, reminders, verified quests, gamification, and agent approvals into the default authenticated Socos workflow. Yev should be able to open Socos on desktop or Pixel, understand today's relationship priorities in under a minute, take low-risk CRM actions, and approve or reject risky agent proposals without exposing personal data outside Coolify.

## Product Direction

The cockpit is a quiet personal work surface, not a marketing dashboard. It minimizes administration and supports uneven social energy by presenting a bounded queue: two or three people, important dates, optional event suggestions, verified quests, upcoming reminders, and agent proposals. Gamification reports useful momentum and verified progress; it does not award XP for viewing, accepting, snoozing, or dismissing an item.

The autonomy boundary remains unchanged:

- Reads, summaries, activity updates, reminders, feedback, and verified quest completion are automatic.
- Messages, introductions, invitations, merges, and deletions remain agent-created proposals requiring explicit human approval.
- The browser does not impersonate Hermes or manufacture an agent proposal. Provider executors remain a later slice.

## Approaches Considered

### 1. Client-composed cockpit over durable APIs (selected)

Add `/dashboard/today` and compose the existing brief, reminder, streak, gamification, and proposal services in the browser. Add only the missing owner-scoped approval-history read contract. This preserves service ownership, allows each panel to degrade independently, and avoids creating another aggregate model that can drift from the Hermes/MCP brief.

### 2. New backend cockpit aggregate

Add one `/dashboard/today` API response that joins every domain. This reduces browser requests, but couples unrelated failure domains, duplicates stable presenters, and creates a second versioned response beside `DailyBrief`. It is not justified for a single-user first release.

### 3. Full dashboard and domain rewrite

Replace brief, reminders, gamification, contacts, and approvals with a new workflow model. This could simplify the long-term information architecture, but it would discard already reviewed concurrency, idempotency, evidence, and approval guarantees. The risk and migration cost are disproportionate.

## Information Architecture

`/dashboard` redirects to `/dashboard/today`. Desktop navigation exposes Today and Contacts; disabled placeholders remain only for Calendar, Gamification, and Settings. Mobile adds a stable bottom navigation for Today, Contacts, and the Approvals anchor.

The Today page has two responsive tracks:

- The primary track contains the date/header, brief readiness state, people, important dates, and feature-gated events. Each recommendation is an individual compact card with reasoning, current state, and direct actions.
- The utility track contains Momentum, verified quests, reminders, and approval inbox/history as unframed sections separated by borders. It becomes a single ordered stream on Pixel `412x915`.

No page section is wrapped in a decorative card and no card is nested inside another card. Repeated recommendations, quests, reminders, and proposals may use cards with at most an 8px radius. Stable button/icon dimensions prevent layout shifts. The existing dark palette remains, but primary violet, action green, warning amber, and error red have distinct semantic jobs.

## Read Contracts

The browser composes:

- `GET /api/briefs/today`; on exact `404 BRIEF_NOT_READY`, call `POST /api/briefs/generate` once and render that durable result.
- `GET /api/gamification/stats` and `GET /api/gamification/streak`.
- `GET /api/reminders/upcoming`.
- `GET /api/agent-proposals/history?status=all&limit=20&offset=0`.
- `GET /api/briefs/quests/:questId/action` when a pending quest is expanded.

The new history response is owner-scoped, bounded, newest-first, and uses an explicit safe projection:

```ts
interface ProposalHistoryResponse {
  proposals: Array<{
    id: string;
    actionType: "message" | "introduction" | "invitation" | "merge" | "delete";
    preview:
      | { type: "message"; contact: { id: string; name: string }; channel: string; body: string }
      | { type: "introduction"; contact: { id: string; name: string }; otherContact: { id: string; name: string }; context: string | null }
      | { type: "invitation"; contact: { id: string; name: string }; title: string; scheduledAt: string | null }
      | { type: "merge"; sourceContact: { id: string; name: string }; targetContact: { id: string; name: string } }
      | { type: "delete"; entityType: "contact" | "interaction" | "reminder"; entityId: string; label: string }
      | { type: "unavailable"; label: "Unavailable preview" };
    status: "pending" | "approved" | "rejected" | "expired";
    expiresAt: string;
    decidedAt: string | null;
    createdAt: string;
    client: { id: string; name: string };
    grant: null | {
      status: string;
      expiresAt: string;
      consumedAt: string | null;
      revokedAt: string | null;
      outbox: null | {
        status: string;
        attempts: number;
        completedAt: string | null;
        lastErrorCode: string | null;
      };
    };
  }>;
  total: number;
  offset: number;
  limit: number;
}
```

The response excludes `ownerId`, raw payload, payload hash, metadata, and audit rows. The preview is an action-specific human-review projection with owner-scoped contact names; it contains the exact message/context/title needed for a decision but not unrelated CRM fields. Query status is allowlisted and limit is capped at 50. Reading history expires stale pending proposals before returning them.

The quest action endpoint preserves the stable Hermes `DailyBrief` schema while making server-owned evidence targets usable by the browser:

```ts
type QuestAction =
  | {
      questId: string;
      completionType: "interaction";
      contact: { id: string; name: string };
    }
  | {
      questId: string;
      completionType: "reminder";
      contact: { id: string; name: string };
      reminder: {
        id: string;
        title: string;
        scheduledAt: string;
        status: "pending" | "completed";
      };
    };
```

It derives the owner from JWT, rejects foreign/demo resources with the same `404`, and returns no interaction, reminder, or contact body.

## Actions And Idempotency

Brief recommendation actions use the existing feedback endpoint:

- Focus maps to `accept`.
- Snooze uses an explicit future timestamp selected from a small menu.
- Dismiss supports an optional short reason.

Every feedback or quest intent gets a random key matching `^[A-Za-z0-9._:-]{8,128}$`. A retry of the same unresolved intent reuses its key; a successful intent clears it. Transport failure is treated as an unknown outcome and the UI refetches the durable brief before offering another mutation.

Quest completion remains server-verified:

- Interaction quests load the server-owned target, create a non-demo interaction for that contact, and submit its returned ID as evidence.
- Reminder quests load the exact existing reminder target, atomically complete it, and submit that reminder ID as evidence.
- If evidence creation succeeds but quest completion fails, the in-memory completion state retains the evidence ID and retries only quest completion.
- XP and level stats refresh only after the server confirms completion.

People and date items can open the owner-scoped contact profile and create a reminder. Upcoming reminders can be completed through the existing atomic completion route. Agent proposals can be approved or rejected; the cockpit then refreshes history. Approval does not claim that provider execution occurred. Grant/outbox state is shown separately.

## State And Failure Handling

Brief, momentum, reminders, and approvals load independently with abortable requests. Authentication failures continue through the shared JWT client. A missing brief triggers one explicit generation attempt; other `404`, validation, or server failures remain visible and retryable.

Mutations have per-item pending state, disable only the affected controls, preserve form input, and surface both inline errors and the shared toast. Empty states distinguish no recommendations, no reminders, no quests, and no proposals. Disabled Calendar/location/event flags do not produce fake suggestions.

All browser fixtures, screenshots, and Betabots data are synthetic. Production validation is aggregate-only. No contact contents, interaction bodies, exact locations, proposal previews, credentials, or tokens are printed during deployment validation.

## Verification

- Jest proves approval-history ownership, status allowlisting, expiry, pagination, human-readable minimal projection, and grant/outbox status.
- Jest proves quest-action target ownership, demo exclusion, exact minimal projections, and stable Hermes brief compatibility.
- Vitest proves stable intent-key reuse/clear, brief generation fallback decisions, state updates, date handling, and preview formatting without personal fixtures.
- Playwright with intercepted synthetic APIs proves dashboard redirect, brief generation fallback, Focus/Snooze/Dismiss payloads and keys, contact opening, reminder creation/completion, verified interaction/reminder quest completion, approval/rejection, independent error states, keyboard operation, and no horizontal overflow at `412x915`.
- An independent reviewer checks security, behavior, accessibility, and responsive layout.
- A synthetic Betabots cohort exercises the cockpit without source-code or personal-data access. The formal real-backend gate remains separate until the safe integrity-attestation endpoint exists.

## Deferred

- Provider-specific execution after approval.
- Browser-originated outbound proposal creation; agents already create proposals through scoped MCP tools.
- Calendar/Pixel enrollment and enabling event flags.
- Weekly campaigns, social adventures, tangible reward inventory, and richer memory correction/provenance UI.
- httpOnly-cookie/BFF authentication hardening.
