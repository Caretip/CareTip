-- Slice F-C: category retention job types (fail-closed infrastructure).
-- Does not invent T_* durations. Does not enable production destruction.

ALTER TYPE "DataLifecycleJobType" ADD VALUE 'notify_cleanup';
ALTER TYPE "DataLifecycleJobType" ADD VALUE 'guest_scrub';
ALTER TYPE "DataLifecycleJobType" ADD VALUE 'billing_redact';
ALTER TYPE "DataLifecycleJobType" ADD VALUE 'staff_pii_scrub';
