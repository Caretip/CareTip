-- I-R2 remediation: make F-C enum labels idempotent on fresh and partially-applied DBs.
-- Safe no-op when labels already exist. Non-destructive. Does not invent T_* values.

ALTER TYPE "DataLifecycleJobType" ADD VALUE IF NOT EXISTS 'notify_cleanup';
ALTER TYPE "DataLifecycleJobType" ADD VALUE IF NOT EXISTS 'guest_scrub';
ALTER TYPE "DataLifecycleJobType" ADD VALUE IF NOT EXISTS 'billing_redact';
ALTER TYPE "DataLifecycleJobType" ADD VALUE IF NOT EXISTS 'staff_pii_scrub';
