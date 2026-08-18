export {
  PHYSICAL_QR_CURRENCY,
  PHYSICAL_QR_CONTEXT_TYPES,
  PHYSICAL_QR_FONT_STATUS,
  PHYSICAL_QR_PRINT_DPI,
  PHYSICAL_QR_PRINT_HEIGHT_MM,
  PHYSICAL_QR_PRINT_HEIGHT_PX,
  PHYSICAL_QR_PRINT_WIDTH_MM,
  PHYSICAL_QR_PRINT_WIDTH_PX,
  PHYSICAL_QR_TEMPORARY_FONT_FAMILY,
  PHYSICAL_QR_TEMPLATE_ID,
  PHYSICAL_QR_VIEWBOX_HEIGHT,
  PHYSICAL_QR_VIEWBOX_WIDTH,
  type PhysicalQrColorTokens,
  type PhysicalQrContextType,
  type PhysicalQrProductTemplate,
  type PhysicalQrRenderInput,
  type PhysicalQrSupportedField,
  type PhysicalQrZone,
} from "./types";
export {
  PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
  PHYSICAL_QR_MODULE_DARK,
  PHYSICAL_QR_MODULE_LIGHT,
  PHYSICAL_QR_WELL_FILL,
  isPhysicalQrHexColor,
  mergePhysicalQrColorTokens,
  normalizePhysicalQrHex,
  tryParsePhysicalQrHex,
  validatePhysicalQrColorTokens,
} from "./colors";
export {
  CARETIP_A5_FLYER_TEMPLATE,
  getPhysicalQrTemplate,
  isPhysicalQrTemplateId,
  listPhysicalQrTemplates,
} from "./registry";
export { escapePhysicalQrXml, renderPhysicalQrSvg } from "./svg";
export {
  injectPhysicalQrSvg,
  physicalQrSvgToDataUrl,
  svgHidesAddress,
  svgShowsAddress,
} from "./inject";
export {
  buildPhysicalQrRenderInput,
  renderPhysicalQrPreviewSvg,
  type PhysicalQrPreviewModel,
} from "./renderer";
export {
  PHYSICAL_QR_PROCESSING_TIMEZONE,
  classifyPhysicalQrProcessingClient,
  type PhysicalQrProcessingClass,
} from "./processing";
