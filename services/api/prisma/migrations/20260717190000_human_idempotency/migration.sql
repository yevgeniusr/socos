CREATE TABLE "HumanIdempotencyRecord" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'in_progress',
  "response" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "HumanIdempotencyRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HumanIdempotencyRecord_status_check" CHECK ("status" IN ('in_progress', 'completed')),
  CONSTRAINT "HumanIdempotencyRecord_requestHash_check" CHECK (char_length("requestHash") = 64)
);

CREATE UNIQUE INDEX "HumanIdempotencyRecord_ownerId_operation_idempotencyKey_key"
  ON "HumanIdempotencyRecord"("ownerId", "operation", "idempotencyKey");
CREATE INDEX "HumanIdempotencyRecord_expiresAt_idx"
  ON "HumanIdempotencyRecord"("expiresAt");

ALTER TABLE "HumanIdempotencyRecord"
  ADD CONSTRAINT "HumanIdempotencyRecord_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
