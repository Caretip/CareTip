/**
 * Physical-product Stripe Checkout. Unit price is a temporary test amount until
 * the official EUR price (and VAT/shipping treatment) is supplied.
 *
 * Activation requires:
 * - catalogue `priceCents` set (> 0)
 * - catalogue `orderable = true`
 * - env PHYSICAL_QR_CHECKOUT_ENABLED is not "false"
 *   (unset/true enables checkout for testing)
 */

export const PHYSICAL_QR_PRICE_NOT_CONFIGURED = "PRICE_NOT_CONFIGURED" as const;
export const PHYSICAL_QR_CHECKOUT_NOT_ACTIVATED = "CHECKOUT_NOT_ACTIVATED" as const;
export const PHYSICAL_QR_CHECKOUT_METADATA_SOURCE = "physical_qr_order" as const;

export function isPhysicalQrCheckoutEnvEnabled(): boolean {
  return process.env.PHYSICAL_QR_CHECKOUT_ENABLED !== "false";
}

export class PhysicalQrCheckoutBlockedError extends Error {
  readonly code: typeof PHYSICAL_QR_PRICE_NOT_CONFIGURED | typeof PHYSICAL_QR_CHECKOUT_NOT_ACTIVATED;
  constructor(
    code: typeof PHYSICAL_QR_PRICE_NOT_CONFIGURED | typeof PHYSICAL_QR_CHECKOUT_NOT_ACTIVATED,
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

export function assertPhysicalQrCheckoutReady(product: {
  priceCents: number | null;
  orderable: boolean;
  currency: string;
}): void {
  if (product.priceCents == null || product.priceCents <= 0 || !product.orderable) {
    throw new PhysicalQrCheckoutBlockedError(
      PHYSICAL_QR_PRICE_NOT_CONFIGURED,
      "Physical Branding pricing is not configured yet.",
    );
  }
  if (product.currency !== "EUR") {
    throw new PhysicalQrCheckoutBlockedError(
      PHYSICAL_QR_PRICE_NOT_CONFIGURED,
      "Physical Branding products must be priced in EUR.",
    );
  }
  if (!isPhysicalQrCheckoutEnvEnabled()) {
    throw new PhysicalQrCheckoutBlockedError(
      PHYSICAL_QR_CHECKOUT_NOT_ACTIVATED,
      "Physical Branding checkout is not activated.",
    );
  }
}
