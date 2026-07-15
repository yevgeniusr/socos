ALTER TABLE "DMSession"
  ADD COLUMN "debrief" JSONB,
  ADD COLUMN "debriefStartedAt" TIMESTAMP(3),
  ADD COLUMN "sceneStartedAt" TIMESTAMP(3),
  ADD COLUMN "xpAwardedAt" TIMESTAMP(3);
