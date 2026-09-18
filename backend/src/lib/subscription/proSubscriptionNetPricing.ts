/**
 * Product-truth Pro SaaS net fees (EUR cents).
 * Checkout always charges the configured Stripe Price ID — never these amounts.
 * Used for marketing alignment checks and ops verification only.
 */
export const PRO_NET_MONTHLY_EUR_CENTS = 2900; // €29.00
export const PRO_NET_YEARLY_EUR_CENTS = 27840; // €278.40

export const PRO_NET_MONTHLY_EUR = PRO_NET_MONTHLY_EUR_CENTS / 100;
export const PRO_NET_YEARLY_EUR = PRO_NET_YEARLY_EUR_CENTS / 100;
