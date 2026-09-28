ALTER TABLE "integration_health"
  ADD COLUMN "refresh_attempts" integer,
  ADD COLUMN "successful_refreshes" integer;