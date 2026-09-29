ALTER TABLE "title_aliases"
  ADD COLUMN "provider_sources" text[] DEFAULT ARRAY[]::text[] NOT NULL;

UPDATE "title_aliases" AS alias
SET "provider_sources" = ARRAY[
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM "provider_mappings" AS mapping
      WHERE mapping."title_id" = alias."title_id"
        AND mapping."provider" = 'TVMaze'
    ) THEN 'tvmaze'
    ELSE 'wikipedia'
  END
]
WHERE alias."is_editorial" = false
  AND alias."source_url" IS NOT NULL;