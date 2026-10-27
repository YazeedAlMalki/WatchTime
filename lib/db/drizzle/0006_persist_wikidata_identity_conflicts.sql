CREATE TABLE "wikidata_identity_conflicts" (
  "id" serial PRIMARY KEY NOT NULL,
  "title_id" integer NOT NULL REFERENCES "titles"("id") ON DELETE CASCADE,
  "imdb_id" text NOT NULL,
  "conflicting_entity_ids" jsonb NOT NULL,
  "error" text NOT NULL,
  "detected_at" timestamp DEFAULT now() NOT NULL,
  "reviewed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wikidata_identity_conflicts_title_unique_idx"
  ON "wikidata_identity_conflicts" USING btree ("title_id");
--> statement-breakpoint
CREATE INDEX "wikidata_identity_conflicts_reviewed_detected_idx"
  ON "wikidata_identity_conflicts" USING btree ("reviewed_at", "detected_at");
