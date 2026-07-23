/**
 * MVP launch policy — flip flags when KYC becomes a product requirement.
 * Keep in sync with `src/app/lib/mvpVerificationPolicy.ts`.
 */
export const MVP_KYC_DOCUMENT_UPLOAD_ENABLED = false;

/** Hide all KYC UI from business managers (nav, badges, widgets, routes). */
export const MVP_KYC_BUSINESS_UI_ENABLED = false;

/** Replace platform admin KYC management with Coming Soon (API/schema remain). */
export const MVP_KYC_ADMIN_MANAGEMENT_ENABLED = false;

/**
 * Policy A: while MVP KYC is disabled, `receiveTips` follows onboarding approval.
 * When any KYC product surface is re-enabled, `receiveTips` again requires KYC verified.
 */
export function isKycRequiredForReceiveTips(): boolean {
  return (
    MVP_KYC_DOCUMENT_UPLOAD_ENABLED ||
    MVP_KYC_BUSINESS_UI_ENABLED ||
    MVP_KYC_ADMIN_MANAGEMENT_ENABLED
  );
}
