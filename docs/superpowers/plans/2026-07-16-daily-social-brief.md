# Daily Social Brief V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one durable, useful daily relationship brief containing two or three people, upcoming important dates, two to four verifiable quests, and feedback actions that Hermes can safely read and record.

**Architecture:** Add a focused `briefs` NestJS module backed by durable PostgreSQL batches, ranked items, quests, feedback events, and an append-only XP ledger. Pure timezone, recurrence, health, and ranking functions make recommendation behavior deterministic and testable; an idempotent scheduled service persists each user's local-day brief before Hermes retrieves it. V1 is rule-based and authenticated with the existing JWT guard: it records feedback and verified CRM outcomes but cannot send messages, create invitations, or perform introductions.

**Tech Stack:** Node.js 22, TypeScript 5.9, NestJS 11, Prisma 6/PostgreSQL 15, Jest 29, `Intl.DateTimeFormat`, `@nestjs/schedule`, pnpm 10.10.0.

## Global Constraints

- Coolify PostgreSQL remains the only source of truth for real contacts, interactions, reminders, feedback, briefs, and XP transactions.
- Never put real contact values in local fixtures, snapshots, logs, test output, or committed files; tests use synthetic identities only.
- Consume the Monica import contract: `Contact.isDemo`, `sourceSystem`, `sourceId`, `sourceUpdatedAt`, `importedAt`, and `groups` already exist before this plan starts.
- Exclude `isDemo=true` contacts from every brief candidate query, relationship score refresh, agent recommendation, dashboard count, and analytics count.
- Persist at most one brief per owner and local calendar date. A retry returns the existing ready brief and never duplicates items, quests, feedback, or XP.
- Treat IANA timezone names as data. Yev's production user is configured as `Asia/Dubai`; tests also cover UTC day-boundary extremes.
- Award XP only after server-side verification of a completed interaction or reminder. Viewing, accepting, snoozing, or dismissing never awards XP.
- XP amounts and quest completion rules are server-owned. Client-supplied amounts are not accepted by DTOs.
- Outbound messages, introductions, invitations, merges, and deletes are outside this slice and remain approval-gated future work.
- V1 provides an authenticated REST contract for Hermes. Granular agent clients, MCP scopes, audit events, and approval tokens are Delivery Slice 3.
- Preserve applied migrations unchanged. Add one forward-only migration after the contact-provenance migration and prove both fresh and upgraded database paths.
- Use test-first development and commit each task independently.

## File Map

**New domain files**

- `services/api/src/modules/briefs/briefs.types.ts` - internal health, date, recommendation, quest, and response types.
- `services/api/src/modules/briefs/brief-time.ts` - IANA timezone validation, local-date keys, horizon math, and recurring month/day resolution.
- `services/api/src/modules/briefs/relationship-health.ts` - pure relationship health and urgency scoring.
- `services/api/src/modules/briefs/important-dates.service.ts` - owner-scoped collection of birthdays, anniversaries, celebrations, and reminders.
- `services/api/src/modules/briefs/brief-generator.service.ts` - deterministic candidate ranking and atomic batch persistence.
- `services/api/src/modules/briefs/brief-feedback.service.ts` - idempotent accept, snooze, dismiss, and verified completion transactions.
- `services/api/src/modules/briefs/brief-scheduler.service.ts` - periodic local-hour generation.
- `services/api/src/modules/briefs/briefs.dto.ts` - validated HTTP inputs.
- `services/api/src/modules/briefs/briefs.controller.ts` - guarded Hermes-facing REST endpoints.
- `services/api/src/modules/briefs/briefs.module.ts` - module ownership and exports.
- `services/api/src/modules/briefs/*.spec.ts` - focused unit and controller tests.
- `services/api/test/briefs.integration.spec.ts` - PostgreSQL concurrency, ownership, and XP integrity tests.
- `services/api/jest.integration.config.cjs` - disposable-PostgreSQL integration-only Jest target.
- `scripts/run-brief-integration.mjs` - fail-closed disposable database validation and test launcher.
- `services/api/prisma/migrations/20260716130000_daily_social_brief/migration.sql` - forward-only domain migration after contact provenance.
- `docs/integrations/hermes-social-brief.md` - versioned REST payload and reply mapping.

**Existing files changed**

- `services/api/prisma/schema.prisma` - preferences, contact cadence, brief records, feedback, quests, and XP transactions.
- `services/api/src/app.module.ts` - import `BriefsModule` only.
- `services/api/src/modules/contacts/contacts.dto.ts` - validate importance and cadence.
- `services/api/src/modules/contacts/contacts.controller.ts` - place static `due` route before `:id`.
- `services/api/src/modules/agents/agents.service.ts` - inject Prisma and return the real non-demo contact count.
- `services/api/src/modules/agents/strategies/relationship-agent.ts` - use shared health logic and exclude demos.
- `services/api/src/modules/agents/strategies/suggestion-agent.ts` - exclude demos and remove the invalid introduction traversal from v1 results.
- `services/api/src/modules/notifications/notification-scheduler.service.ts` - remove the hourly all-celebrations fan-out superseded by durable briefs.
- `services/api/src/modules/gamification/gamification.service.ts` - exclude demo contacts from contact-derived analytics and achievements.
- `packages/agent-core/src/tools/tool-schema.ts` - stable Hermes Daily Brief v1 response/action types.
- `scripts/migration-safety.integration.test.mjs` - verify the new forward-only migration.
- `scripts/security-regression.test.mjs` - ensure brief mutation routes remain guarded and contain no direct-send operation.

---

### Task 1: Persist Brief Preferences And Domain Records

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260716130000_daily_social_brief/migration.sql`
- Modify: `scripts/migration-safety.integration.test.mjs`
- Modify: `services/api/src/modules/contacts/contacts.dto.ts`
- Create: `services/api/src/modules/briefs/briefs.types.ts`

**Interfaces:**
- Produces: `User.timeZone: string` with default `UTC` and `User.briefHourLocal: number` with default `8`.
- Produces: `Contact.importance: number` with default `3` and `Contact.preferredCadenceDays: number` with default `90`.
- Produces: Prisma models `BriefBatch`, `BriefItem`, `Quest`, `BriefFeedback`, and `XpTransaction`.
- Produces: `BriefItemKind = 'person' | 'date'`, `BriefItemStatus = 'pending' | 'accepted' | 'snoozed' | 'dismissed'`, and `QuestStatus = 'pending' | 'completed'` in `briefs.types.ts`.

- [ ] **Step 1: Extend the migration safety test and prove it fails**

Add assertions that a fresh database and an upgraded database both contain the five new tables, two contact preference columns, two user preference columns, and these exact uniqueness contracts:

```js
const expectedUniqueIndexes = [
  'BriefBatch_ownerId_localDate_key',
  'BriefFeedback_ownerId_idempotencyKey_key',
  'XpTransaction_ownerId_sourceType_sourceId_key',
];
```

Run:

```bash
node scripts/migration-safety.integration.test.mjs
```

Expected: FAIL because `BriefBatch` and the new columns do not exist.

- [ ] **Step 2: Add the Prisma models and relations**

Use scalar strings for status values to match the repository's existing schema style. Add the following fields and constraints:

```prisma
model BriefBatch {
  id          String   @id @default(cuid())
  ownerId     String
  owner       User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  localDate   DateTime @db.Date
  timeZone    String
  status      String   @default("generating")
  generatedAt DateTime?
  schemaVersion String @default("1.0")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  items       BriefItem[]
  quests      Quest[]

  @@unique([ownerId, localDate], map: "BriefBatch_ownerId_localDate_key")
  @@index([ownerId, status])
}

model BriefItem {
  id             String   @id @default(cuid())
  batchId        String
  batch          BriefBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  ownerId        String
  owner          User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  contactId      String?
  kind           String
  sourceType     String
  sourceId       String?
  rank           Int
  score          Float
  title          String
  reason         String
  evidence       Json
  status         String   @default("pending")
  snoozedUntil   DateTime?
  actionedAt     DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  quests         Quest[]
  feedback       BriefFeedback[]

  @@unique([batchId, kind, rank])
  @@index([ownerId, contactId])
  @@index([ownerId, status, snoozedUntil])
}

model Quest {
  id             String   @id @default(cuid())
  batchId        String
  batch          BriefBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  ownerId        String
  owner          User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  briefItemId    String
  briefItem      BriefItem @relation(fields: [briefItemId], references: [id], onDelete: Cascade)
  title          String
  completionType String
  targetId       String
  xpReward       Int
  status         String   @default("pending")
  completedAt    DateTime?
  createdAt      DateTime @default(now())
  feedback       BriefFeedback[]

  @@unique([batchId, briefItemId])
  @@index([ownerId, status])
}

model BriefFeedback {
  id             String   @id @default(cuid())
  ownerId        String
  owner          User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  briefItemId    String?
  briefItem      BriefItem? @relation(fields: [briefItemId], references: [id], onDelete: Cascade)
  questId        String?
  quest          Quest? @relation(fields: [questId], references: [id], onDelete: Cascade)
  action         String
  reason         String?
  snoozedUntil   DateTime?
  idempotencyKey String
  requestHash    String
  createdAt      DateTime @default(now())

  @@unique([ownerId, idempotencyKey], map: "BriefFeedback_ownerId_idempotencyKey_key")
  @@index([ownerId, briefItemId, createdAt])
}

model XpTransaction {
  id         String   @id @default(cuid())
  ownerId    String
  owner      User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  amount     Int
  sourceType String
  sourceId   String
  createdAt  DateTime @default(now())

  @@unique([ownerId, sourceType, sourceId], map: "XpTransaction_ownerId_sourceType_sourceId_key")
  @@index([ownerId, createdAt])
}
```

Add `briefBatches`, `briefItems`, `quests`, `briefFeedback`, and `xpTransactions` relation arrays to `User`. Keep `BriefItem.contactId`, `Quest.targetId`, and ledger `sourceId` deliberately scalar in v1 so historical records survive later contact/reminder cleanup.

- [ ] **Step 3: Write the forward-only SQL migration**

The migration must add non-null preference columns with defaults, create all tables, foreign keys, and named indexes, and avoid updating personal rows. Add database checks for `importance BETWEEN 1 AND 5`, `preferredCadenceDays BETWEEN 7 AND 365`, `briefHourLocal BETWEEN 0 AND 23`, `xpReward >= 0`, and exactly one non-null feedback target using `num_nonnulls("briefItemId", "questId") = 1`. Do not add `Asia/Dubai` to the migration; configure that value through the cloud database after deployment without printing the user row.

- [ ] **Step 4: Validate contact preference inputs**

Add optional DTO properties with class-validator bounds:

```ts
@IsOptional()
@IsInt()
@Min(1)
@Max(5)
importance?: number;

@IsOptional()
@IsInt()
@Min(7)
@Max(365)
preferredCadenceDays?: number;
```

Apply them to both create and update DTOs so manual adjustments use normal owner-scoped contact endpoints.

- [ ] **Step 5: Regenerate Prisma and run schema checks**

```bash
pnpm --filter @socos/api exec prisma format
pnpm --filter @socos/api exec prisma generate
node scripts/migration-safety.integration.test.mjs
pnpm --filter @socos/api type:check
```

Expected: all exit 0; migration test passes both fresh and upgraded paths.

- [ ] **Step 6: Commit**

```bash
git add services/api/prisma services/api/src/modules/contacts/contacts.dto.ts services/api/src/modules/briefs/briefs.types.ts scripts/migration-safety.integration.test.mjs
git commit -m "feat: add durable social brief schema"
```

### Task 2: Make Time And Important Dates Deterministic

**Files:**
- Create: `services/api/src/modules/briefs/brief-time.ts`
- Create: `services/api/src/modules/briefs/brief-time.spec.ts`
- Create: `services/api/src/modules/briefs/important-dates.service.ts`
- Create: `services/api/src/modules/briefs/important-dates.service.spec.ts`
- Modify: `services/api/src/modules/celebrations/celebrations.service.ts`
- Modify: `services/api/src/modules/notifications/notification-scheduler.service.ts`
- Create: `services/api/src/modules/notifications/__tests__/notification-scheduler.service.spec.ts`

**Interfaces:**
- Produces: `assertTimeZone(timeZone: string): void`.
- Produces: `localDateKey(now: Date, timeZone: string): string` returning `YYYY-MM-DD`.
- Produces: `dateKeyToUtcDate(key: string): Date` using UTC midnight solely as the PostgreSQL `DATE` carrier.
- Produces: `daysFromLocalDate(now: Date, timeZone: string, month: number, day: number): { dateKey: string; daysAway: number }` resolving the next annual occurrence.
- Produces: `ImportantDatesService.collect(ownerId: string, now: Date, timeZone: string, horizonDays: number): Promise<ImportantDateCandidate[]>`.

- [ ] **Step 1: Write failing timezone boundary tests**

Use fixed instants and assert local dates without changing process timezone:

```ts
expect(localDateKey(new Date('2026-07-16T20:30:00Z'), 'Asia/Dubai')).toBe('2026-07-17');
expect(localDateKey(new Date('2026-01-01T00:30:00Z'), 'Pacific/Honolulu')).toBe('2025-12-31');
expect(() => assertTimeZone('Mars/Olympus')).toThrow('Invalid IANA time zone');
```

Also test December-to-January recurrence, February 29 rolling to the next leap year, a same-day event, and a 14-day inclusive horizon.

Run:

```bash
pnpm --filter @socos/api test -- --runInBand src/modules/briefs/brief-time.spec.ts
```

Expected: FAIL because `brief-time.ts` does not exist.

- [ ] **Step 2: Implement timezone helpers with `Intl.DateTimeFormat`**

Construct one cached formatter per IANA timezone with numeric `year`, `month`, and `day`; convert its `formatToParts` result into an integer UTC ordinal. Never use host-local `getDate()`, `setDate()`, or `toLocaleDateString()` for ranking or persistence.

- [ ] **Step 3: Write failing important-date collection tests**

Mock Prisma with synthetic contacts and prove the collector:

- returns birthdays, anniversaries, active `shouldRemind=true` contact celebrations, and pending reminders;
- excludes demo and foreign-owner contacts;
- ignores ignored celebrations and completed/overdue reminders outside the horizon;
- deduplicates a reminder generated for the same contact/date/occasion as a birthday or celebration;
- sorts by `daysAway`, then type priority, then stable source ID;
- returns no contact content in logs or thrown messages.

- [ ] **Step 4: Implement the collector**

Return this internal shape:

```ts
export interface ImportantDateCandidate {
  sourceType: 'birthday' | 'anniversary' | 'celebration' | 'reminder';
  sourceId: string;
  contactId: string;
  contactName: string;
  title: string;
  dateKey: string;
  daysAway: number;
  reason: string;
}
```

Reuse one exported celebration occurrence helper from `celebrations.service.ts` for Gregorian, lunar, and Chinese recurrence rather than maintaining two algorithms. Keep every database query owner-scoped and require `contact.isDemo=false`.

- [ ] **Step 5: Replace the unsafe celebration fan-out**

Delete `handleUpcomingCelebrations`, its hourly cron decorator, and the all-active-celebrations query. Celebration dates now appear once in a durable brief; this scheduler must not send every active celebration every hour. Keep due-reminder scheduling and overdue marking unchanged.

Update the scheduler spec to assert that no cron method queries `contactCelebration.findMany` without a date window and no hourly celebration direct-send method exists.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter @socos/api test -- --runInBand src/modules/briefs/brief-time.spec.ts src/modules/briefs/important-dates.service.spec.ts src/modules/notifications/__tests__/notification-scheduler.service.spec.ts
pnpm --filter @socos/api type:check
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add services/api/src/modules/briefs services/api/src/modules/celebrations/celebrations.service.ts services/api/src/modules/notifications
git commit -m "feat: collect timezone-safe important dates"
```

### Task 3: Share Relationship Health And Repair Existing Agent Defects

**Files:**
- Create: `services/api/src/modules/briefs/relationship-health.ts`
- Create: `services/api/src/modules/briefs/relationship-health.spec.ts`
- Modify: `services/api/src/modules/agents/strategies/relationship-agent.ts`
- Create: `services/api/src/modules/agents/strategies/relationship-agent.spec.ts`
- Modify: `services/api/src/modules/agents/strategies/suggestion-agent.ts`
- Create: `services/api/src/modules/agents/strategies/suggestion-agent.spec.ts`
- Modify: `services/api/src/modules/agents/agents.service.ts`
- Create: `services/api/src/modules/agents/agents.service.spec.ts`
- Modify: `services/api/src/modules/agents/agents.module.ts`
- Modify: `services/api/src/modules/contacts/contacts.controller.ts`
- Create: `services/api/src/modules/contacts/contacts.controller.spec.ts`
- Modify: `services/api/src/modules/gamification/gamification.service.ts`
- Create: `services/api/src/modules/gamification/gamification.service.spec.ts`

**Interfaces:**
- Produces: `assessRelationship(input: RelationshipHealthInput): RelationshipHealth`.
- Produces: health `{ score: number; band: 'excellent' | 'healthy' | 'needs-attention' | 'at-risk'; daysSinceContact: number | null; daysOverdue: number; reasonCode: string }`.
- Produces: `rankRelationship(input: RelationshipRankInput): number`, a deterministic `0..100` urgency score.

- [ ] **Step 1: Write failing pure scoring tests**

Pin `now` and cover these exact rules:

```ts
// Health: 100 at day 0, 50 at one full cadence, 0 at two cadences.
// Never contacted: health 35 and reasonCode "never_contacted".
// Urgency: (100 - health) * 0.5 + importance * 8 + dateBoost + commitmentBoost.
// dateBoost: 20 within 7 days, 10 within 14 days, otherwise 0.
// commitmentBoost: 15 when at least one pending task exists.
// Clamp urgency to 0..100 and round both outputs to integers.
```

Test 30-, 90-, and 180-day cadences; importance 1 and 5; future `lastContactedAt` clamped to zero days; and invalid cadence rejected.

- [ ] **Step 2: Implement the pure health and urgency functions**

Use injected `now`, never `Date.now()`. Importance changes urgency, not relationship health. `createdAt` and `importedAt` are not contact events and must not be used as `lastContactedAt` substitutes.

- [ ] **Step 3: Write failing agent regression tests**

Prove:

- `RelationshipAgent` excludes demo contacts and calls the shared health function with per-contact cadence;
- `refreshScores` never updates demos;
- `SuggestionAgent` excludes demos from every query;
- the existing introduction method does not claim contact-to-contact evidence derived from `Interaction.contact`, which always refers to the same contact;
- `AgentsService.getDashboard` returns the real count from injected Prisma and excludes demos;
- gamification contact counts exclude demos;
- a booted Nest test application dispatches `GET /contacts/due` to `getDueContacts`, never `findOne('due')`.

- [ ] **Step 4: Repair agent ownership and route ordering**

Inject `PrismaService` into `AgentsService` through `AgentsModule` and remove `private prisma: any = null`. Add `isDemo: false` to relationship, suggestion, dashboard, and contact-derived analytics queries. Make the introduction endpoint return `success: false`, `data: []`, and error code `INSUFFICIENT_GRAPH_DATA` until the later introduction graph model exists; do not fabricate mutual-contact evidence.

Move `@Get('due')` above `@Get(':id')` without changing its public URL.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter @socos/api test -- --runInBand src/modules/briefs/relationship-health.spec.ts src/modules/agents src/modules/contacts/contacts.controller.spec.ts src/modules/gamification/gamification.service.spec.ts
pnpm --filter @socos/api type:check
```

Expected: all pass; dashboard count is no longer hard-coded to zero.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/modules/briefs/relationship-health* services/api/src/modules/agents services/api/src/modules/contacts services/api/src/modules/gamification
git commit -m "fix: share relationship health and exclude demo data"
```

### Task 4: Generate One Atomic Daily Brief

**Files:**
- Create: `services/api/src/modules/briefs/brief-generator.service.ts`
- Create: `services/api/src/modules/briefs/brief-generator.service.spec.ts`
- Create: `services/api/src/modules/briefs/briefs.presenter.ts`
- Create: `services/api/src/modules/briefs/briefs.presenter.spec.ts`

**Interfaces:**
- Consumes: `ImportantDatesService.collect(...)`, `assessRelationship(...)`, `rankRelationship(...)`, and Prisma.
- Produces: `BriefGeneratorService.generateForOwner(ownerId: string, now: Date): Promise<DailyBriefV1>`.
- Produces: `BriefGeneratorService.getReadyForOwner(ownerId: string, now: Date): Promise<DailyBriefV1 | null>`; retrieval performs no writes.
- Produces: `presentBrief(batch): DailyBriefV1`, the stable Hermes shape defined in Task 6.

- [ ] **Step 1: Write failing ranking and selection tests**

Using synthetic contacts, assert generation:

- selects exactly the top three eligible people when at least three exist, or all when only one or two exist;
- ranks across bounded contact cursor pages so a highest-urgency contact after the first 100 rows is still selected;
- orders by urgency descending, then importance descending, then contact ID for deterministic ties;
- includes health, last interaction timestamp, reason code, human-readable reason, and structured evidence;
- adds at most five date items inside the 14-day inclusive horizon;
- excludes demos, contacts snoozed beyond `now`, and contacts dismissed in the preceding 30 days;
- paginates active feedback so repeated rows for one contact cannot hide another contact's cooldown;
- allows a previously dismissed contact after the 30-day cooling period;
- creates two to four quests when at least two distinct verifiable person/reminder targets exist,
  preferring one quest per selected person and then pending-reminder quests; when only zero or one
  distinct target exists, emits every available target without duplication rather than fabricating a
  second rewardable action;
- treats a target with an existing pending quest for the owner as unavailable, loading pending targets
  across bounded cursor pages and rechecking them in the serializable write transaction so the same
  action cannot stack pending quests across daily batches;
- assigns only server-owned rewards: `15` XP for `interaction` quests and `20` XP for `reminder` quests.

- [ ] **Step 2: Write failing atomicity and retry tests**

Mock an interactive Prisma transaction and prove:

- batch, items, and quests are created inside one transaction;
- a mid-generation insert failure rolls back the batch, items, and quests together;
- a PostgreSQL `P2002` unique conflict waits for the winning transaction, then fetches and returns its existing `ready` batch;
- a PostgreSQL `P2034` serialization loser retries the complete load/rank/plan flow within a bounded budget so it observes the winner's pending quest targets;
- no caller can observe a `generating` batch because creation and the final `ready` update share one transaction;
- if the transaction-time pending-target recheck makes the first quest candidates unavailable, later distinct candidates backfill the two-to-four quest budget;
- a second call for the same owner/local date returns byte-equivalent presenter data and creates nothing.

- [ ] **Step 3: Implement candidate loading and deterministic reasons**

Load non-demo contacts with the latest interaction, pending tasks, and recent feedback in bounded queries. Use reason templates keyed by evidence, for example:

```ts
const reasons = {
  never_contacted: 'No interaction has been recorded yet.',
  cadence_overdue: (days: number) => `Preferred check-in cadence is overdue by ${days} days.`,
  important_date: (title: string, days: number) => `${title} is in ${days} days.`,
  pending_commitment: 'There is an unfinished commitment linked to this contact.',
};
```

Do not call an LLM during batch generation. A provider outage must not prevent the daily brief.

- [ ] **Step 4: Implement atomic persistence and read-only retrieval**

Represent the local date as `dateKeyToUtcDate(localDateKey(now, user.timeZone))`. Run the unique batch insert, item inserts, quest inserts, and final `status='ready'` update in one interactive transaction. A concurrent insert blocks on the unique key and then resolves through the committed ready batch; a failed winner rolls back so the next caller can insert. `getReadyForOwner` uses `findUnique` plus includes and returns `null` for missing or non-ready rows; it never calls `generateForOwner`.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter @socos/api test -- --runInBand src/modules/briefs/brief-generator.service.spec.ts src/modules/briefs/briefs.presenter.spec.ts
pnpm --filter @socos/api type:check
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/modules/briefs
git commit -m "feat: generate durable daily social briefs"
```

### Task 5: Record Feedback And Award XP Exactly Once

**Files:**
- Create: `services/api/src/modules/briefs/brief-feedback.service.ts`
- Create: `services/api/src/modules/briefs/brief-feedback.service.spec.ts`
- Create: `services/api/src/modules/briefs/briefs.dto.ts`

**Interfaces:**
- Produces: `BriefFeedbackService.recordItemFeedback(ownerId, itemId, idempotencyKey, dto): Promise<BriefFeedbackResult>`.
- Produces: `BriefFeedbackService.completeQuest(ownerId, questId, idempotencyKey, dto): Promise<QuestCompletionResult>`.
- Consumes: `Idempotency-Key` values matching `^[A-Za-z0-9._:-]{8,128}$`.
- Consumes: item actions `accept`, `snooze`, `dismiss`; completion evidence `{ interactionId: string }` or `{ reminderId: string }`.

- [ ] **Step 1: Write failing feedback state tests**

Assert owner-scoped item feedback behavior:

- `accept` changes `pending` or `snoozed` to `accepted`;
- `snooze` requires an ISO timestamp after `now` and no more than 90 days ahead;
- `dismiss` permits an optional reason of at most 500 characters;
- an item from another owner returns `NotFoundException`;
- the same idempotency key and same canonical request returns the original result;
- the same key with a different item, action, or body returns `ConflictException`;
- feedback inserts and item state changes happen in one transaction;
- no feedback action changes user XP.

Compute `requestHash` from a canonical JSON object using Node `createHash('sha256')`; never log raw reason text.

- [ ] **Step 2: Write failing verified-completion tests**

For `completionType='interaction'`, require an interaction that belongs to the same owner and target contact and whose `occurredAt >= quest.createdAt`. For `completionType='reminder'`, require the target reminder owned by the same user with `status='completed'` and `completedAt >= quest.createdAt`.

Assert one transaction performs:

```ts
quest.update({ status: 'completed', completedAt: now });
xpTransaction.create({ ownerId, amount: quest.xpReward, sourceType: 'quest', sourceId: quest.id });
user.update({ xp: { increment: quest.xpReward }, lastActiveAt: now });
briefFeedback.create({ action: 'complete', idempotencyKey, requestHash });
```

Also prove ten concurrent completion retries using the same idempotency key produce one feedback event, one XP transaction, one XP increment, one completed quest, and equivalent successful responses. A later completion intent with a different key returns `ConflictException` with code `QUEST_ALREADY_COMPLETED` and does not add feedback or XP.

- [ ] **Step 3: Implement DTO validation and canonical hashing**

Use discriminated runtime validation in the service because class-validator does not reliably validate TypeScript unions. Reject unknown fields using the application's global validation pipe. Do not expose `xpReward` in any input DTO.

- [ ] **Step 4: Implement conditional claims and immutable ledger writes**

Inside a serializable Prisma transaction, claim with `quest.updateMany({ where: { id, ownerId, status: 'pending' } })`. If the claim loses, read the ledger and prior feedback to distinguish an idempotent completion from a conflicting request. Rely on the unique XP source constraint as the final concurrency guard.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter @socos/api test -- --runInBand src/modules/briefs/brief-feedback.service.spec.ts
pnpm --filter @socos/api type:check
```

Expected: all pass, including concurrent completion.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/modules/briefs/brief-feedback.service.ts services/api/src/modules/briefs/brief-feedback.service.spec.ts services/api/src/modules/briefs/briefs.dto.ts
git commit -m "feat: record brief feedback and verified quest XP"
```

### Task 6: Publish The Hermes REST Contract

**Files:**
- Create: `services/api/src/modules/briefs/briefs.controller.ts`
- Create: `services/api/src/modules/briefs/briefs.controller.spec.ts`
- Create: `services/api/src/modules/briefs/briefs.module.ts`
- Modify: `services/api/src/app.module.ts`
- Modify: `packages/agent-core/src/tools/tool-schema.ts`
- Modify: `packages/agent-core/src/tools/index.ts`
- Create: `docs/integrations/hermes-social-brief.md`

**Interfaces:**
- Produces: `GET /api/briefs/today`.
- Produces: `POST /api/briefs/items/:itemId/feedback` with required `Idempotency-Key` header.
- Produces: `POST /api/briefs/quests/:questId/complete` with required `Idempotency-Key` header.
- Produces: shared `DailyBriefV1`, `BriefItemFeedbackInput`, and `QuestCompletionInput` interfaces from `@socos/agent-core`.

- [ ] **Step 1: Write failing controller contract tests**

Use Nest metadata and direct controller tests to prove:

- controller prefix is `briefs`, all routes have `AuthGuard` and bearer metadata;
- the authenticated `request.user.userId` is the only owner identity passed to services;
- missing brief returns HTTP 404 with code `BRIEF_NOT_READY`, not an on-demand write;
- missing/invalid `Idempotency-Key` returns 400;
- request bodies cannot contain `ownerId`, `userId`, `xpReward`, recipient, message-send, invite, introduction, merge, or delete commands;
- owner scoping is delegated on every service call.

- [ ] **Step 2: Define the exact Hermes v1 response**

Export this stable shape from `packages/agent-core` and make the presenter return it:

```ts
export interface DailyBriefV1 {
  schemaVersion: '1.0';
  briefId: string;
  localDate: string;
  timeZone: string;
  generatedAt: string;
  people: Array<{
    itemId: string;
    rank: number;
    contact: { id: string; name: string };
    health: { score: number; band: 'excellent' | 'healthy' | 'needs-attention' | 'at-risk' };
    lastInteractionAt: string | null;
    reason: string;
    evidence: Array<{ code: string; value: string | number | null }>;
    state: 'pending' | 'accepted' | 'snoozed' | 'dismissed';
  }>;
  dates: Array<{
    itemId: string;
    rank: number;
    contact: { id: string; name: string };
    type: 'birthday' | 'anniversary' | 'celebration' | 'reminder';
    title: string;
    date: string;
    daysAway: number;
    reason: string;
    state: 'pending' | 'accepted' | 'snoozed' | 'dismissed';
  }>;
  quests: Array<{
    questId: string;
    itemId: string;
    title: string;
    completionType: 'interaction' | 'reminder';
    xpReward: number;
    status: 'pending' | 'completed';
  }>;
  allowedActions: ['accept', 'snooze', 'dismiss', 'complete'];
}
```

- [ ] **Step 3: Implement guarded endpoints and module ownership**

`BriefsModule` owns all brief controllers and providers and exports only `BriefGeneratorService`. `AppModule` imports `BriefsModule`; it does not duplicate its providers. Map `getReadyForOwner=null` to `NotFoundException({ code: 'BRIEF_NOT_READY', message: 'Today\'s brief is not ready.' })`.

- [ ] **Step 4: Document Hermes polling and reply mapping**

Document environment-variable examples, never a real token:

```bash
curl --fail --silent \
  -H "Authorization: Bearer $SOCOS_TOKEN" \
  "$SOCOS_URL/api/briefs/today"
```

Map Discord replies to actions: `accept <itemId>`, `snooze <itemId> <ISO time>`, `dismiss <itemId> [reason]`, and `complete <questId> <interactionId|reminderId>`. Hermes generates a new stable idempotency key per user intent and reuses it only for transport retries. State explicitly that v1 cannot send a message or introduction and that HTTP 404 means Hermes should post nothing and retry after the next scheduler interval.

- [ ] **Step 5: Run contract tests and builds**

```bash
pnpm --filter @socos/api test -- --runInBand src/modules/briefs/briefs.controller.spec.ts src/modules/briefs/briefs.presenter.spec.ts
pnpm --filter @socos/agent-core type:check
pnpm --filter @socos/api type:check
pnpm --filter @socos/api build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/modules/briefs services/api/src/app.module.ts packages/agent-core docs/integrations/hermes-social-brief.md
git commit -m "feat: expose Hermes daily brief contract"
```

### Task 7: Schedule Local-Day Brief Generation

**Files:**
- Create: `services/api/src/modules/briefs/brief-scheduler.service.ts`
- Create: `services/api/src/modules/briefs/brief-scheduler.service.spec.ts`
- Modify: `services/api/src/modules/briefs/briefs.module.ts`

**Interfaces:**
- Produces: `BriefSchedulerService.generateDueBriefs(now = new Date()): Promise<{ generated: number; existing: number; failed: number }>`.
- Consumes: `User.timeZone`, `User.briefHourLocal`, and `BriefGeneratorService.generateForOwner`.

- [ ] **Step 1: Write failing scheduler tests**

At a fixed instant, provide synthetic users in Dubai, Honolulu, and Kiritimati and assert only users whose local hour equals `briefHourLocal` are selected. Also prove:

- invalid stored timezone records a sanitized user ID/count failure and continues;
- an already-ready local-date brief is counted as existing;
- one user failure does not prevent other users;
- the job never logs email, contact names, date titles, or feedback reasons;
- two scheduler invocations produce one batch because generation is idempotent.

- [ ] **Step 2: Implement the bounded scheduler**

Run every 15 minutes:

```ts
@Cron('0 */15 * * * *', { name: 'generate-daily-social-briefs' })
async handleCron(): Promise<void> {
  await this.generateDueBriefs(new Date());
}
```

Load users in pages of 100, use a concurrency limit of five without adding a dependency, and process only users with at least one non-demo contact. Consider a user due during all four scheduler ticks in their chosen hour; the database uniqueness constraint prevents duplication.

- [ ] **Step 3: Register the scheduler once**

Add it to `BriefsModule.providers`. Do not add another `ScheduleModule.forRoot()` because `AppModule` already owns the global scheduler.

- [ ] **Step 4: Run focused tests**

```bash
pnpm --filter @socos/api test -- --runInBand src/modules/briefs/brief-scheduler.service.spec.ts
pnpm --filter @socos/api type:check
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/briefs
git commit -m "feat: schedule local-time daily briefs"
```

### Task 8: Prove PostgreSQL Concurrency, Authorization, And Regression Safety

**Files:**
- Create: `services/api/test/briefs.integration.spec.ts`
- Create: `services/api/jest.integration.config.cjs`
- Create: `scripts/run-brief-integration.mjs`
- Modify: `scripts/security-regression.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm test:brief-integration`, enabled only when `BRIEF_TEST_DATABASE_URL` points to a disposable PostgreSQL database.
- Produces: a security regression rule that all brief routes are guarded and no route contains direct-send or destructive action names.

- [ ] **Step 1: Write the disposable PostgreSQL integration suite**

Seed only synthetic users, vaults, contacts, interactions, reminders, and celebrations. Run real Prisma operations to prove:

1. Twenty concurrent `generateForOwner` calls create one batch and at most eight items. The batch has two to four quests when at least two distinct verifiable targets exist; otherwise it has every available distinct target (zero or one).
2. A forced transaction failure creates zero batch rows.
3. Ten concurrent quest completions increment XP once and create one ledger row.
4. Reusing an idempotency key with different content returns 409 and leaves state unchanged.
5. One owner cannot retrieve, action, or complete another owner's records.
6. Dubai local dates remain correct on both sides of UTC midnight.
7. December 31 to January 1 birthdays and celebrations appear once.
8. Demo contacts never appear in batches or counts.
9. `GET /api/briefs/today` performs no insert or update.

The suite must refuse a database URL whose database name does not end in `_test`.

- [ ] **Step 2: Run once to observe missing integration wiring**

```bash
BRIEF_TEST_DATABASE_URL="$DISPOSABLE_SOCOS_TEST_DATABASE_URL" pnpm test:brief-integration
```

Expected: FAIL because the root script/Jest integration target is not yet defined.

- [ ] **Step 3: Add the explicit integration command**

Keep this suite outside the API Jest config's `rootDir: 'src'`. Create `jest.integration.config.cjs` with `rootDir: '.'`, `testRegex: 'test/.*\\.integration\\.spec\\.ts$'`, the existing ESM `.js` module mapper, and `maxWorkers: 1`.

Create `scripts/run-brief-integration.mjs` to parse `BRIEF_TEST_DATABASE_URL` with `new URL()`, reject absent/invalid values, and reject database pathnames that do not end in `_test` before invoking Prisma. Spawn the migration and Jest commands with `DATABASE_URL` set in the child environment; never print the URL. Propagate a nonzero child exit code. The suite cleans synthetic rows in `afterAll`.

```js
import { spawnSync } from 'node:child_process';

const raw = process.env.BRIEF_TEST_DATABASE_URL;
if (!raw) throw new Error('BRIEF_TEST_DATABASE_URL is required');

let parsed;
try {
  parsed = new URL(raw);
} catch {
  throw new Error('BRIEF_TEST_DATABASE_URL is invalid');
}
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
if (!databaseName.endsWith('_test')) {
  throw new Error('Brief integration tests require a database ending in _test');
}

const env = { ...process.env, DATABASE_URL: raw };
for (const args of [
  ['--filter', '@socos/api', 'exec', 'prisma', 'migrate', 'deploy'],
  ['--filter', '@socos/api', 'exec', 'jest', '--config', 'jest.integration.config.cjs', '--runInBand'],
]) {
  const result = spawnSync('pnpm', args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
```

The root script is:

```json
{
  "test:brief-integration": "node scripts/run-brief-integration.mjs"
}
```

- [ ] **Step 4: Extend the security regression scan**

Assert `BriefsController` has `AuthGuard`, reads owner identity only from `request.user`, requires `Idempotency-Key` on both mutations, and exposes no paths matching `send`, `message`, `invite`, `introduce`, `merge`, or `delete`.

- [ ] **Step 5: Run the complete local gate**

```bash
pnpm --filter @socos/api exec prisma generate
pnpm test
BRIEF_TEST_DATABASE_URL="$DISPOSABLE_SOCOS_TEST_DATABASE_URL" pnpm test:brief-integration
pnpm type:check
pnpm build
pnpm lint
node scripts/security-regression.mjs
git diff --check
```

Expected: all exit 0. Lint may report existing admitted warnings but no errors.

- [ ] **Step 6: Commit**

```bash
git add services/api/test/briefs.integration.spec.ts services/api/jest.integration.config.cjs scripts/run-brief-integration.mjs scripts/security-regression.test.mjs package.json
git commit -m "test: prove daily brief integrity"
```

### Task 9: Deploy Safely And Validate The Personal Loop

**Files:**
- Modify: `docs/runbooks/production-migration-baseline.md`
- Modify: `docs/integrations/hermes-social-brief.md`
- Create: `docs/validation/daily-social-brief-v1.md`

**Interfaces:**
- Consumes: existing Coolify deployment, backup, offsite verification, and production login from secure local configuration.
- Produces: aggregate-only deployment evidence and a rollback point.

- [ ] **Step 1: Trigger and verify a pre-deploy backup**

Trigger the configured Coolify PostgreSQL backup and poll until success. Verify the latest backup is replicated to the encrypted offsite destination. Record only execution ID, timestamp, size, checksum result, and aggregate table counts; never copy a dump or personal row to the local workspace.

- [ ] **Step 2: Deploy the migration and application image**

Push the tested commit, trigger Coolify deployment, and wait for healthy status. Confirm `prisma migrate deploy` applies `20260716130000_daily_social_brief` exactly once and the API health endpoint returns 200.

- [ ] **Step 3: Configure the personal timezone cloud-side**

Through a server-side transaction or authenticated settings operation, set the single production user's `timeZone='Asia/Dubai'` and `briefHourLocal=8`. Verify only the aggregate count `updated=1`; do not print the row, email, or ID.

- [ ] **Step 4: Generate and inspect the first production brief safely**

Invoke the scheduler service through its normal scheduled execution, then authenticate to `GET /api/briefs/today`. Validate locally only the contract shape and aggregate counts:

```text
schemaVersion=1.0
people=1..3
dates=0..5
quests=2..4 when at least two eligible actions exist
demo_people=0
```

Inspect actual contact content only through the authenticated production UI or Hermes delivery; do not redirect it to files or command logs.

- [ ] **Step 5: Validate feedback without outbound action**

Using one production brief item, perform `accept`, retry with the same idempotency key, then `snooze` or `dismiss` on a different item. Verify aggregate feedback rows increased once per unique intent and XP did not change. Do not mark a quest complete unless a real qualifying interaction or reminder completion exists.

- [ ] **Step 6: Run a focused synthetic Betabot wave**

Against staging with synthetic contacts, run eight first-person personas on the pinned `gpt-5.5-2026-04-23` snapshot covering low social energy, networking urgency, travel, family dates, administrative skepticism, gamification enthusiasm, frequent dismissal, and sparse relationship history. Require:

- aggregate happiness at least 70;
- 90 percent completion of brief read, snooze/dismiss, and verified quest flows;
- zero critical defects or high-confidence trust blockers;
- no outbound message or introduction performed by Socos;
- every high-confidence complaint fixed or recorded as an intentional tradeoff in `docs/validation/daily-social-brief-v1.md`.

- [ ] **Step 7: Record aggregate validation and rollback instructions**

Document commit SHA, deployment ID, migration count, backup execution ID, aggregate brief counts, test commands, Betabot metrics, and rollback procedure. Do not include names, titles, reasons, interaction text, contact IDs, or tokens.

- [ ] **Step 8: Commit documentation**

```bash
git add docs/runbooks/production-migration-baseline.md docs/integrations/hermes-social-brief.md docs/validation/daily-social-brief-v1.md
git commit -m "docs: validate daily social brief rollout"
```

## Completion Gate

The slice is complete only when all conditions hold:

- Fresh and upgraded PostgreSQL migration tests pass.
- All unit, controller, integration, type, build, lint, and security regression commands pass.
- Concurrent generation produces one local-day batch; concurrent completion produces one XP transaction.
- Read retrieval is write-free, mutations are owner-scoped, and retries are idempotent.
- Important dates are timezone-safe and the unsafe hourly all-celebration sender is removed.
- Existing dashboard, due-contact route, demo filtering, and invalid introduction evidence defects are covered by regressions.
- Production remains healthy after a verified rollback-ready backup and forward-only migration.
- The first cloud brief contains no demo contacts and is retrievable by the documented Hermes REST contract.
- The focused Betabot wave meets the release thresholds without unresolved critical or trust defects.

## Deferred To Later Delivery Slices

- MCP transport, agent-client registration, granular scopes, mutation audit events, and approval tokens.
- Google Calendar OAuth, Pixel OwnTracks ingestion, visits, planned-city inference, and nearby event adapters.
- Contact-to-contact graph evidence, introduction ranking, draft introductions, and approval-gated sending.
- Attributed facts and free-form memories with source, confidence, correction, and review state.
- Campaigns, weekly reflections, preference-learning models, leaderboards, and unverified self-reported quests.
