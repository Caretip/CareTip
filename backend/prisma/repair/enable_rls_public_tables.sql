-- Enable RLS on all CareTip application tables (PostgREST anon/authenticated bypass prevention).
-- Run in Supabase SQL Editor when audit reports RLS disabled.
-- Prisma/pooler `postgres` role bypasses RLS by default — app continues to work.
-- No permissive policies for anon/authenticated: default deny via RLS with zero policies.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'User',
    'user_settings',
    'push_device_tokens',
    'notifications',
    'announcements',
    'support_tickets',
    'support_ticket_messages',
    'refresh_tokens',
    'password_reset_tokens',
    'email_verification_tokens',
    'employee_activation_tokens',
    'audit_logs',
    'stripe_webhook_events',
    'businesses',
    'employee_invites',
    'employee_invite_redemptions',
    'locations',
    'venue_tables',
    '_EmployeeTableAssignments',
    'employees',
    'employee_goals',
    'tips',
    'tip_feedback',
    'oauth_accounts',
    'setup_notification_states',
    'platform_product_feedback',
    'consumed_mfa_challenges',
    'mobile_web_handoff_tokens',
    'facebook_oauth_states',
    'facebook_oauth_completions',
    'stripe_connect_payouts',
    'stripe_connect_payout_balance_lines',
    'stripe_connect_instant_payout_requests',
    'stripe_connect_scheduled_payout_requests',
    'sponsored_access_grants',
    'employee_stripe_accounts',
    'employee_stripe_scheduled_payout_requests',
    'scheduled_payout_tick_fairness_cursors',
    'scheduled_payout_ops_incidents',
    'scheduled_payout_ops_incident_deliveries',
    'employee_stripe_payouts',
    'employee_instant_payout_requests',
    'employee_tip_payables',
    'employee_tip_distribution_batches',
    'employee_tip_distribution_items',
    'employee_tip_distribution_allocations',
    'tip_receipt_sequences',
    'subscriptions',
    'subscription_events',
    'subscription_billing_notifications',
    'subscription_billing_reconciliation_cursors',
    'subscription_billing_reconciliation_runs',
    'subscription_billing_drift_findings',
    'qr_guest_visits',
    'qr_scan_events',
    'qr_funnel_events',
    'feature_utilization_daily',
    'business_activity_events',
    'tip_refunds',
    'legal_documents',
    'account_recovery_requests',
    'data_lifecycle_jobs',
    'physical_qr_products',
    'physical_qr_orders',
    'physical_qr_order_items',
    'physical_qr_order_messages',
    'physical_qr_order_internal_notes'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- Verify (expect rls_enabled = true for all rows):
-- SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
-- FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1;
