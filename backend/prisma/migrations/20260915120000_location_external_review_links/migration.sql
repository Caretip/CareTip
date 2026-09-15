-- Optional per-location Google Place ID + TripAdvisor review URL for post-payment guest links.

ALTER TABLE "locations" ADD COLUMN "google_place_id" VARCHAR(256);
ALTER TABLE "locations" ADD COLUMN "tripadvisor_review_url" VARCHAR(2048);
