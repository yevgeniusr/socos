# Daily Cockpit Proof Layer Design

## Problem

The valid real-PostgreSQL cohort at
`.betabots/runs/20260717-042212-daily-cockpit-rerun2-real-postgres`
still failed the release gate. Four of five bots repeated proof or diligence
friction. Two date-focused mobile users selected the reminder action on a
person card labelled with an important-date signal and received a generic
follow-up draft. Successful reminder creation returned them to the long queue
without a durable confirmation. The gamification persona did not discover the
quest area because it follows the complete focus queue on mobile.

The approval receipt passed clearly. The retrospective interaction journey was
also completed and understood; its formal evidence miss came from a transient
toast pattern, so this iteration does not add another Contacts abstraction.

## Design

Keep DailyBrief V1 and V1.1 unchanged. When a person item has numeric
`important_date_days` evidence, match an existing date item by contact ID and
the same `daysAway`. Use that structured date item to build the reminder draft.
If there is no exact match, preserve the current follow-up draft. Never infer a
date type from free text.

After a successful reminder POST, construct a `ReminderReceipt` from the exact
submitted body and selected brief timezone. Resolve the stable intent only
after the successful response, close the dialog, keep the receipt visible even
if reminder refresh fails, and focus its heading. The receipt reports the
contact, type, title, and scheduled time. It does not award XP or imply an
outbound action.

Add a compact header link such as `4 open quests` when the ready brief has
pending quests. The link targets the existing `Verified quests` heading, which
must be focusable. This is a visible navigation aid, not scripted completion or
automatic scrolling.

## Boundaries

- Preserve approval-is-not-execution and server-verified XP rules.
- Preserve DailyBrief and reminder request contracts.
- Preserve stable reminder idempotency and response-loss recovery.
- Use only synthetic tests and keep Betabots artifacts ignored.
- Do not add provider execution, Calendar, location, or event activation.

## Verification

Unit tests cover exact structured date matching and fallback. Browser tests
cover a person-card important-date reminder prefill, one stable POST body/key,
a persistent focused receipt across refresh failure, and the visible quest
anchor on Pixel. Then rerun the complete web suite, typecheck, build, focused
Playwright, independent review, and a fresh real-backend cohort.
