CREATE TABLE IF NOT EXISTS "rate_limit_hits" (
  "key" text PRIMARY KEY NOT NULL,
  "hits" integer DEFAULT 1 NOT NULL,
  "reset_time" timestamp NOT NULL
);