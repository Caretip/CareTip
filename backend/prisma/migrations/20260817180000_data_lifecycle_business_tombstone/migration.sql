-- Additive job type for business tombstone orchestration.
-- Does not enable DATA_LIFECYCLE_TOMBSTONE_EXECUTE. Does not mutate business rows.

ALTER TYPE "DataLifecycleJobType" ADD VALUE IF NOT EXISTS 'business_tombstone';
