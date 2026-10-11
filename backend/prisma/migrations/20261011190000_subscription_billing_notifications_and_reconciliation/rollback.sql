-- Rollback Sprint 2 billing notification + reconciliation tables (disposable DBs only).

DROP TABLE IF EXISTS "subscription_billing_drift_findings";
DROP TABLE IF EXISTS "subscription_billing_reconciliation_runs";
DROP TYPE IF EXISTS "SubscriptionBillingDriftStatus";
DROP TYPE IF EXISTS "SubscriptionBillingDriftKind";

DROP TABLE IF EXISTS "subscription_billing_notifications";
DROP TYPE IF EXISTS "SubscriptionBillingNotificationStatus";
DROP TYPE IF EXISTS "SubscriptionBillingNotificationType";
