ALTER TABLE "title_aliases"
  ADD COLUMN "provider_sources" text[] DEFAULT ARRAY[]::text[] NOT NULL;

UPDATE "title_aliases" AS alias
SET "provider_sources" = CASE
  WHEN (
    (alias."source_name" = 'TVMaze'
      OR alias."source_url" ~* '^https?://(www\.)?tvmaze\.com/')
    AND NOT (
      alias."source_name" ILIKE '%Wikipedia'
      OR alias."source_url" ~* '^https?://([a-z0-9-]+\.)?wikipedia\.org/'
    )
    AND EXISTS (
      SELECT 1
      FROM "provider_mappings" AS mapping
      WHERE mapping."title_id" = alias."title_id"
        AND mapping."provider" = 'TVMaze'
    )
  ) THEN ARRAY['tvmaze']::text[]
  WHEN (
    (alias."source_name" ILIKE '%Wikipedia'
      OR alias."source_url" ~* '^https?://([a-z0-9-]+\.)?wikipedia\.org/')
    AND NOT (
      alias."source_name" = 'TVMaze'
      OR alias."source_url" ~* '^https?://(www\.)?tvmaze\.com/'
    )
    AND EXISTS (
      SELECT 1
      FROM "provider_mappings" AS mapping
      WHERE mapping."title_id" = alias."title_id"
        AND mapping."provider" = 'Wikipedia'
    )
  ) THEN ARRAY['wikipedia']::text[]
  WHEN NOT (
    alias."source_name" = 'TVMaze'
    OR alias."source_url" ~* '^https?://(www\.)?tvmaze\.com/'
    OR alias."source_name" ILIKE '%Wikipedia'
    OR alias."source_url" ~* '^https?://([a-z0-9-]+\.)?wikipedia\.org/'
  ) AND EXISTS (
    SELECT 1
    FROM "provider_mappings" AS mapping
    WHERE mapping."title_id" = alias."title_id"
      AND mapping."provider" = 'TVMaze'
  ) AND NOT EXISTS (
    SELECT 1
    FROM "provider_mappings" AS mapping
    WHERE mapping."title_id" = alias."title_id"
      AND mapping."provider" = 'Wikipedia'
  ) THEN ARRAY['tvmaze']::text[]
  WHEN NOT (
    alias."source_name" = 'TVMaze'
    OR alias."source_url" ~* '^https?://(www\.)?tvmaze\.com/'
    OR alias."source_name" ILIKE '%Wikipedia'
    OR alias."source_url" ~* '^https?://([a-z0-9-]+\.)?wikipedia\.org/'
  ) AND EXISTS (
    SELECT 1
    FROM "provider_mappings" AS mapping
    WHERE mapping."title_id" = alias."title_id"
      AND mapping."provider" = 'Wikipedia'
  ) AND NOT EXISTS (
    SELECT 1
    FROM "provider_mappings" AS mapping
    WHERE mapping."title_id" = alias."title_id"
      AND mapping."provider" = 'TVMaze'
  ) THEN ARRAY['wikipedia']::text[]
  ELSE ARRAY[]::text[]
END
WHERE alias."is_editorial" = false
  AND alias."source_url" IS NOT NULL;