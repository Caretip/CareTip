import { PHYSICAL_QR_DEFAULT_COLOR_TOKENS } from "./colors";
import {
  PHYSICAL_QR_FONT_STATUS,
  PHYSICAL_QR_PRINT_DPI,
  PHYSICAL_QR_PRINT_HEIGHT_MM,
  PHYSICAL_QR_PRINT_HEIGHT_PX,
  PHYSICAL_QR_PRINT_WIDTH_MM,
  PHYSICAL_QR_PRINT_WIDTH_PX,
  PHYSICAL_QR_TEMPORARY_FONT_FAMILY,
  PHYSICAL_QR_TEMPLATE_ID,
  PHYSICAL_QR_TEMPLATE_IDS,
  PHYSICAL_QR_VIEWBOX_HEIGHT,
  PHYSICAL_QR_VIEWBOX_WIDTH,
  type PhysicalQrProductTemplate,
  type PhysicalQrTemplateId,
} from "./types";

/**
 * Geometry measured from the CareTip A5 reference artwork (148×210 mm).
 * Address is a dynamic overlay, not a second flattened file.
 */
function a5Template(
  id: PhysicalQrTemplateId,
  nameKey: string,
  descriptionKey: string,
): PhysicalQrProductTemplate {
  return {
    id,
    nameKey,
    descriptionKey,
    printWidthMm: PHYSICAL_QR_PRINT_WIDTH_MM,
    printHeightMm: PHYSICAL_QR_PRINT_HEIGHT_MM,
    printDpi: PHYSICAL_QR_PRINT_DPI,
    printWidthPx: PHYSICAL_QR_PRINT_WIDTH_PX,
    printHeightPx: PHYSICAL_QR_PRINT_HEIGHT_PX,
    viewBoxWidth: PHYSICAL_QR_VIEWBOX_WIDTH,
    viewBoxHeight: PHYSICAL_QR_VIEWBOX_HEIGHT,
    supportsAddress: true,
    supportedFields: ["qr", "businessName", "address"],
    qrWellZone: { x: 361, y: 752, w: 689, h: 693 },
    qrZone: { x: 401, y: 792, w: 609, h: 613 },
    businessNameZone: { x: 120, y: 1472, w: 1170, h: 48 },
    addressZone: { x: 120, y: 1528, w: 1170, h: 80 },
    colorTokens: PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
    fontFamily: PHYSICAL_QR_TEMPORARY_FONT_FAMILY,
    fontStatus: PHYSICAL_QR_FONT_STATUS,
  };
}

export const CARETIP_A5_FLYER_TEMPLATE = a5Template(
  PHYSICAL_QR_TEMPLATE_ID,
  "business.qrStudio.physical.templateName",
  "business.qrStudio.physical.templateDesc",
);

const TEMPLATES: readonly PhysicalQrProductTemplate[] = [CARETIP_A5_FLYER_TEMPLATE];

const BY_ID = new Map<string, PhysicalQrProductTemplate>(TEMPLATES.map((tpl) => [tpl.id, tpl]));

export function getPhysicalQrTemplate(id: string): PhysicalQrProductTemplate | null {
  return BY_ID.get(id.trim()) ?? null;
}

export function listPhysicalQrTemplates(): readonly PhysicalQrProductTemplate[] {
  return TEMPLATES;
}

export function isPhysicalQrTemplateId(id: string | null | undefined): boolean {
  return BY_ID.has(String(id ?? "").trim());
}

export { PHYSICAL_QR_TEMPLATE_IDS };
