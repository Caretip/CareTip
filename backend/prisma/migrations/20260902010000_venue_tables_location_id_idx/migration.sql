-- Tables are always queried through location_id (list/count for a venue, QR context,
-- entitlement table-quota checks). Postgres does not index FK columns automatically.
CREATE INDEX IF NOT EXISTS "venue_tables_location_id_idx"
  ON "venue_tables" ("location_id");
