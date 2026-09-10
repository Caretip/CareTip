/**
 * Stakeholder Instant Payout floor for employee Express accounts (EUR).
 * Stripe EU Instant API minimum is separately 40 cents; the effective floor is the max of both.
 */
export const EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS = 3000;

export const EMPLOYEE_INSTANT_PAYOUT_CURRENCY = "eur";
