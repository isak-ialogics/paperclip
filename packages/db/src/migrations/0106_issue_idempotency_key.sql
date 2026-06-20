-- Drizzle migration file
-- idx: 106
-- version: 7

ALTER TABLE "issues" ADD COLUMN "idempotency_key" VARCHAR(255);
CREATE UNIQUE INDEX "issues_idempotency_key_company_id_unique" ON "issues" ("idempotency_key", "company_id") WHERE "idempotency_key" IS NOT NULL AND "status" != 'cancelled';
