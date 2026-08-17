/**
 * Approved CareTip data-retention policy constants.
 *
 * These values are management/legal decisions. Do not invent alternatives.
 * Not client-configurable. Environment overrides that contradict these values
 * must fail closed (see retentionPolicy.helpers.ts).
 */

/** Financial & tip ledger — years from end of calendar year of the event. */
export const FINANCIAL_RETENTION_YEARS = 10;

/** B2B billing / subscription evidence — years from end of calendar year of the event. */
export const BILLING_RETENTION_YEARS = 10;

/** Employee historical/basic information and tip history. */
export const EMPLOYEE_HISTORICAL_RETENTION_YEARS = 10;

/** Required business identity / tax / KYC archive. */
export const BUSINESS_INFORMATION_RETENTION_YEARS = 10;

/** Tax / KYC / verification archive. */
export const KYC_RETENTION_YEARS = 10;

/** Administrative audit trails — years from end of calendar year of the event. */
export const AUDIT_RETENTION_YEARS = 3;

/** Support cases — years from end of calendar year of SupportTicket.closedAt. */
export const SUPPORT_RETENTION_YEARS = 3;

/** Personal QR/session identifiers — hours after the session event. */
export const QR_PERSONAL_ANONYMIZATION_HOURS = 48;

/** In-app notifications — days from createdAt. */
export const NOTIFICATION_RETENTION_DAYS = 90;

/**
 * Account-erasure lifecycle: days after deletionRequestedAt before irreversible
 * personal-profile anonymization becomes eligible.
 */
export const ACCOUNT_ERASURE_GRACE_DAYS = 30;

/**
 * Deletion-cancellation window: days after deletionRequestedAt during which
 * the user may reverse the erasure request. Distinct from ACCOUNT_ERASURE_GRACE_DAYS.
 */
export const DELETION_CANCELLATION_DAYS = 14;

/** Standard (non-admin) security / ephemeral logs. */
export const SECURITY_LOG_RETENTION_DAYS = 30;

/** Placeholder session id after QR personal anonymization (row kept for aggregates). */
export const QR_ANONYMIZED_SESSION_ID = "anon";

export const APPROVED_RETENTION_POLICY = {
  FINANCIAL_RETENTION_YEARS,
  BILLING_RETENTION_YEARS,
  EMPLOYEE_HISTORICAL_RETENTION_YEARS,
  BUSINESS_INFORMATION_RETENTION_YEARS,
  KYC_RETENTION_YEARS,
  AUDIT_RETENTION_YEARS,
  SUPPORT_RETENTION_YEARS,
  QR_PERSONAL_ANONYMIZATION_HOURS,
  NOTIFICATION_RETENTION_DAYS,
  ACCOUNT_ERASURE_GRACE_DAYS,
  DELETION_CANCELLATION_DAYS,
  SECURITY_LOG_RETENTION_DAYS,
} as const;
