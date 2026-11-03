ALTER TABLE "safety_records"
  ADD COLUMN "provider_items" jsonb,
  ADD COLUMN "classification_corrections" jsonb NOT NULL DEFAULT '[]'::jsonb;
