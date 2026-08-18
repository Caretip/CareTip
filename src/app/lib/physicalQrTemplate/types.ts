/** Physical CareTip A5 print template — separate from digital `qrTemplateEngine`. */

export const PHYSICAL_QR_PRINT_WIDTH_MM = 148;
export const PHYSICAL_QR_PRINT_HEIGHT_MM = 210;
export const PHYSICAL_QR_PRINT_DPI = 300;

/** Uploaded A5 flyer artwork is 1410×2000 px (same aspect as 148×210 mm). */
export const PHYSICAL_QR_VIEWBOX_WIDTH = 1410;
export const PHYSICAL_QR_VIEWBOX_HEIGHT = 2000;

export const PHYSICAL_QR_PRINT_WIDTH_PX = Math.round(
  (PHYSICAL_QR_PRINT_WIDTH_MM / 25.4) * PHYSICAL_QR_PRINT_DPI,
);
export const PHYSICAL_QR_PRINT_HEIGHT_PX = Math.round(
  (PHYSICAL_QR_PRINT_HEIGHT_MM / 25.4) * PHYSICAL_QR_PRINT_DPI,
);

export const PHYSICAL_QR_TEMPLATE_ID = "caretip-a5-flyer" as const;

export const PHYSICAL_QR_CURRENCY = "EUR" as const;

export type PhysicalQrContextType = "storefront" | "employee" | "table" | "location";

export const PHYSICAL_QR_CONTEXT_TYPES: readonly PhysicalQrContextType[] = [
  "storefront",
  "employee",
  "table",
  "location",
];

export type PhysicalQrSupportedField = "qr" | "businessName" | "address";

/** ViewBox millimetre-scaled rect. */
export type PhysicalQrZone = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PhysicalQrColorTokens = {
  backgroundGradientStart: string;
  backgroundGradientEnd: string;
  primaryTextColor: string;
  secondaryTextColor: string;
};

/**
 * TEMPORARY DEVELOPMENT FONT — NOT APPROVED FOR PRODUCTION.
 * Official family/weights/files/license are blocked until Fanny supplies them.
 * Do not treat this stack as pixel-perfect CareTip print typography.
 */
export const PHYSICAL_QR_TEMPORARY_FONT_FAMILY =
  'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const PHYSICAL_QR_FONT_STATUS = "TEMPORARY_DEVELOPMENT_FONT_NOT_APPROVED_FOR_PRODUCTION" as const;

export type PhysicalQrProductTemplate = {
  id: typeof PHYSICAL_QR_TEMPLATE_ID;
  nameKey: string;
  descriptionKey: string;
  printWidthMm: typeof PHYSICAL_QR_PRINT_WIDTH_MM;
  printHeightMm: typeof PHYSICAL_QR_PRINT_HEIGHT_MM;
  printDpi: typeof PHYSICAL_QR_PRINT_DPI;
  printWidthPx: number;
  printHeightPx: number;
  viewBoxWidth: number;
  viewBoxHeight: number;
  supportsAddress: boolean;
  supportedFields: readonly PhysicalQrSupportedField[];
  qrZone: PhysicalQrZone;
  qrWellZone: PhysicalQrZone;
  businessNameZone: PhysicalQrZone;
  addressZone: PhysicalQrZone;
  colorTokens: PhysicalQrColorTokens;
  fontFamily: string;
  fontStatus: typeof PHYSICAL_QR_FONT_STATUS;
};

export type PhysicalQrRenderInput = {
  qrDataUrl: string | null;
  businessName: string;
  address: string | null;
  supportsAddress: boolean;
  colorTokens: PhysicalQrColorTokens;
  /** data: URL of the uploaded A5 PNG. Required for a faithful preview/print SVG. */
  artworkDataUrl?: string | null;
};
