-- Keep the newest row for each title/source pair before the partial unique
-- index is created. Season and episode records are intentionally excluded.
WITH ranked_title_records AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY title_id, source_name
      ORDER BY updated_at DESC, id DESC
    ) AS duplicate_rank
  FROM safety_records
  WHERE season_number IS NULL
    AND episode_number IS NULL
)
DELETE FROM safety_records
WHERE id IN (
  SELECT id
  FROM ranked_title_records
  WHERE duplicate_rank > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS safety_records_title_source_unique_idx
  ON safety_records (title_id, source_name)
  WHERE season_number IS NULL
    AND episode_number IS NULL;