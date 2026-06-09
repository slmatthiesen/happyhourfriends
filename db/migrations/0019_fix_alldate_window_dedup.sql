-- Custom SQL migration file, put your code below! --

-- All-day / open-until-close windows store start_time = NULL and/or end_time = NULL. The
-- natural-key unique index treated NULLs as DISTINCT (Postgres default), so re-applying a
-- venue's all-day window never collided and inserted a fresh duplicate every time (Oeste
-- ended up with 4 identical Tue-Wed open-close rows). Fix: dedupe the existing rows, then
-- recreate the index with NULLS NOT DISTINCT so null-timed windows collide and dedupe.

-- 1) Dedupe: keep the best-sourced row per natural key (PARTITION BY groups NULLs together,
--    unlike the unique index), soft-delete the rest. Best = most active offerings, then active,
--    then lowest id (stable).
WITH ranked AS (
  SELECT hh.id,
    row_number() OVER (
      PARTITION BY hh.venue_id, hh.days_of_week, hh.start_time, hh.end_time, hh.location_within_venue
      ORDER BY (SELECT count(*) FROM offerings o WHERE o.happy_hour_id = hh.id AND o.active) DESC,
               hh.active DESC, hh.id
    ) AS rn
  FROM happy_hours hh
  WHERE hh.deleted_at IS NULL
)
UPDATE happy_hours SET deleted_at = now(), updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
--> statement-breakpoint
DROP INDEX IF EXISTS happy_hours_natural_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX happy_hours_natural_uq
  ON happy_hours (venue_id, days_of_week, start_time, end_time, location_within_venue)
  NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;
