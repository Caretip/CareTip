export const PHYSICAL_QR_PRINT_WIDTH_MM = 148;
export const PHYSICAL_QR_PRINT_HEIGHT_MM = 210;
export const PHYSICAL_QR_PRINT_DPI = 300;
export const PHYSICAL_QR_VIEWBOX_WIDTH = 1410;
export const PHYSICAL_QR_VIEWBOX_HEIGHT = 2000;
export const PHYSICAL_QR_PRINT_WIDTH_PX = Math.round(
  (PHYSICAL_QR_PRINT_WIDTH_MM / 25.4) * PHYSICAL_QR_PRINT_DPI,
);
export const PHYSICAL_QR_PRINT_HEIGHT_PX = Math.round(
  (PHYSICAL_QR_PRINT_HEIGHT_MM / 25.4) * PHYSICAL_QR_PRINT_DPI,
);

export const PHYSICAL_QR_TEMPLATE_ID = "caretip-a5-flyer" as const;
export const PHYSICAL_QR_TEMPLATE_CLASSIC_ID = "caretip-classic" as const;
export const PHYSICAL_QR_TEMPLATE_LIGHT_ID = "caretip-light" as const;
export const PHYSICAL_QR_TEMPLATE_MIDNIGHT_ID = "caretip-midnight" as const;
export const PHYSICAL_QR_TEMPLATE_NATURE_ID = "caretip-nature" as const;

/** Allowlisted print artwork IDs. Never accept a client filesystem path. */
export const PHYSICAL_QR_TEMPLATE_IDS = [
  PHYSICAL_QR_TEMPLATE_ID,
  PHYSICAL_QR_TEMPLATE_CLASSIC_ID,
  PHYSICAL_QR_TEMPLATE_LIGHT_ID,
  PHYSICAL_QR_TEMPLATE_MIDNIGHT_ID,
  PHYSICAL_QR_TEMPLATE_NATURE_ID,
] as const;

export type PhysicalQrTemplateId = (typeof PHYSICAL_QR_TEMPLATE_IDS)[number];

/** Classic / Midnight artwork is dark; name and address overlay must be light. */
export const PHYSICAL_QR_LIGHT_OVERLAY_TEXT = "#FFFFFF";

export function physicalQrOverlayTextColor(
  templateId: string | null | undefined,
  fallback: string,
): string {
  const id = String(templateId ?? "").trim();
  if (id === PHYSICAL_QR_TEMPLATE_CLASSIC_ID || id === PHYSICAL_QR_TEMPLATE_MIDNIGHT_ID) {
    return PHYSICAL_QR_LIGHT_OVERLAY_TEXT;
  }
  return fallback;
}

export const PHYSICAL_QR_CURRENCY = "EUR" as const;

/** Temporary test unit price until the official EUR amount is supplied. */
export const PHYSICAL_QR_TEST_UNIT_PRICE_CENTS = 990;

export const PHYSICAL_QR_PRODUCT_ADDRESS_ID = "caretip-a5-flyer-address" as const;
export const PHYSICAL_QR_PRODUCT_NO_ADDRESS_ID = "caretip-a5-flyer-no-address" as const;

export const PHYSICAL_QR_SAMPLE_URL_FORBIDDEN = "https://caretip.app/qr-studio-scan-check";

export type PhysicalQrContextType = "storefront" | "employee" | "table" | "location";
export type PhysicalQrProcessingClass = "SAME_DAY" | "WITHIN_24_HOURS";
export type PhysicalQrPaymentStatus = "PENDING" | "PAID" | "FAILED" | "CANCELLED";
export type PhysicalQrFulfillmentStatus =
  | "PENDING_PAYMENT"
  | "PAID"
  | "PROCESSING"
  | "PRINTING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "PAYMENT_FAILED";

export type PhysicalQrColorTokens = {
  backgroundGradientStart: string;
  backgroundGradientEnd: string;
  primaryTextColor: string;
  secondaryTextColor: string;
};

export type PhysicalQrAddressSnapshot = {
  line: string;
  source: "registered" | "order_edit";
};

/** Germany-only shipping for this phase. */
export const PHYSICAL_QR_SHIP_COUNTRY = "DE" as const;
export type PhysicalQrShipCountry = typeof PHYSICAL_QR_SHIP_COUNTRY;

export type PhysicalQrShippingSnapshot = {
  recipientName: string;
  streetLine: string;
  addressLine2?: string;
  postalCode: string;
  city: string;
  country: PhysicalQrShipCountry;
};

export type PhysicalQrContactSnapshot = {
  name: string;
  email: string;
  phone: string;
  source: "order_form";
};

export type PhysicalQrZone = { x: number; y: number; w: number; h: number };

/**
 * TEMPORARY DEVELOPMENT FONT — NOT APPROVED FOR PRODUCTION.
 * Official family/weights/files/license remain blocked until Fanny supplies them.
 */
export const PHYSICAL_QR_TEMPORARY_FONT_FAMILY =
  'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const PHYSICAL_QR_FONT_STATUS = "TEMPORARY_DEVELOPMENT_FONT_NOT_APPROVED_FOR_PRODUCTION" as const;

export const PHYSICAL_QR_DEFAULT_COLOR_TOKENS: PhysicalQrColorTokens = {
  backgroundGradientStart: "#FFF8F0",
  backgroundGradientEnd: "#F4B184",
  primaryTextColor: "#EB992C",
  secondaryTextColor: "#1A1A1A",
};

export const PHYSICAL_QR_MODULE_DARK = "#111111";
export const PHYSICAL_QR_MODULE_LIGHT = "#FFFFFF";
export const PHYSICAL_QR_WELL_FILL = "#FFFFFF";

export const PHYSICAL_QR_ZONES = {
  qrWellZone: { x: 361, y: 752, w: 689, h: 693 } satisfies PhysicalQrZone,
  qrZone: { x: 401, y: 792, w: 609, h: 613 } satisfies PhysicalQrZone,
  businessNameZone: { x: 120, y: 1472, w: 1170, h: 48 } satisfies PhysicalQrZone,
  addressZone: { x: 120, y: 1528, w: 1170, h: 80 } satisfies PhysicalQrZone,
};

export const PHYSICAL_QR_QUANTITY_MIN = 1;
export const PHYSICAL_QR_QUANTITY_MAX = 50;
