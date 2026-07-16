BEGIN;

-- Event brief suggestions snapshot public event time and coarse city so ready
-- briefs remain stable even if the source event changes or is deleted.
ALTER TABLE "BriefItem"
  ADD COLUMN "eventStartAt" TIMESTAMP(3),
  ADD COLUMN "eventEndAt" TIMESTAMP(3),
  ADD COLUMN "eventCity" TEXT,
  ADD CONSTRAINT "BriefItem_eventSnapshotTime_check" CHECK (
    (
      "eventStartAt" IS NULL
      AND "eventEndAt" IS NULL
    )
    OR (
      "eventStartAt" IS NOT NULL
      AND "eventEndAt" IS NOT NULL
      AND "eventEndAt" > "eventStartAt"
    )
  ),
  ADD CONSTRAINT "BriefItem_eventSnapshotKind_check" CHECK (
    (
      "kind" = 'event'
      AND "eventStartAt" IS NOT NULL
      AND "eventEndAt" IS NOT NULL
    )
    OR (
      "kind" <> 'event'
      AND "eventStartAt" IS NULL
      AND "eventEndAt" IS NULL
      AND "eventCity" IS NULL
    )
  );

COMMIT;
