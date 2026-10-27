CREATE TABLE "alias_review_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "filter_key" text NOT NULL,
  "alias_ids" integer[] NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alias_review_snapshots_expires_at_idx"
  ON "alias_review_snapshots" USING btree ("expires_at");
