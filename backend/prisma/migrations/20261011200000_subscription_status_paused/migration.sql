-- Stripe Billing: mirror Stripe `paused` without mapping to entitled `active`.
-- Apply only on isolated / staging databases — not shared Supabase production without review.
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'paused';
