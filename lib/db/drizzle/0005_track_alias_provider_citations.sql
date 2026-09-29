ALTER TABLE "title_aliases"
  ADD COLUMN "provider_citations" jsonb DEFAULT '{}'::jsonb NOT NULL;

UPDATE "title_aliases"
SET "provider_citations" = CASE
  WHEN 'tvmaze' = ANY("provider_sources")
    AND (
      "source_name" = 'TVMaze'
      OR "source_url" ~* '^https?://(www\.)?tvmaze\.com/'
    )
    THEN jsonb_build_object(
      'tvmaze',
      jsonb_build_object('sourceName', "source_name", 'sourceUrl', "source_url")
    )
  WHEN 'wikipedia' = ANY("provider_sources")
    AND (
      "source_name" ILIKE '%Wikipedia'
      OR "source_url" ~* '^https?://([a-z0-9-]+\.)?wikipedia\.org/'
    )
    THEN jsonb_build_object(
      'wikipedia',
      jsonb_build_object('sourceName', "source_name", 'sourceUrl', "source_url")
    )
  WHEN cardinality("provider_sources") = 1
    THEN jsonb_build_object(
      "provider_sources"[1],
      jsonb_build_object('sourceName', "source_name", 'sourceUrl', "source_url")
    )
  ELSE '{}'::jsonb
END
WHERE "is_editorial" = false
  AND cardinality("provider_sources") > 0;