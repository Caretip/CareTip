export type {
  QrTemplateBrandingPayload,
  QrTemplateDefinition,
  QrTemplateFieldId,
  QrTemplateFieldPosition,
  QrTemplateRenderInput,
} from "./types";

export { QR_TEMPLATE_FIELD_IDS } from "./types";
export {
  buildQrTemplateBrandingPayload,
  mergeFieldVisibility,
  type QrTemplateProfileSlice,
} from "./brandingPayload";
export {
  getEngineTemplate,
  isEngineTemplateId,
  listEngineTemplates,
  listGalleryTemplates,
  POC_LUXURY_SHELL_TEMPLATE_ID,
  INDUSTRY_TEMPLATE_ID,
  VELVET_LOUNGE_TEMPLATE_ID,
  GRAND_ATELIER_TEMPLATE_ID,
  ROYAL_SUITE_TEMPLATE_ID,
  CHAMPAGNE_SALON_TEMPLATE_ID,
  SERENITY_SPA_TEMPLATE_ID,
  ART_DECO_NOIR_TEMPLATE_ID,
  GALLERY_PAVILION_TEMPLATE_ID,
  VELVET_LOUNGE_NOIR_TEMPLATE_ID,
  GRAND_ATELIER_NOIR_TEMPLATE_ID,
  ROYAL_SUITE_PLATINUM_TEMPLATE_ID,
  CHAMPAGNE_SALON_CLASSIC_TEMPLATE_ID,
  EMERALD_SANCTUARY_TEMPLATE_ID,
  SAPPHIRE_PAVILION_TEMPLATE_ID,
  COPPER_HEARTH_TEMPLATE_ID,
  ROSE_GOLD_SALON_TEMPLATE_ID,
  QR_TEMPLATE_ENGINE_REGISTRY,
} from "./registry";
export { engineTemplateLayoutMetrics, renderQrTemplateCard, resolveQrFieldBounds, resolveQrZoneMatrixBounds } from "./renderer";

import type { QrBrandingOptions } from "../businessBranding";
import type { QrStudioDesignExtras } from "../qrDesignSystem";
import { buildQrTemplateBrandingPayload, type QrTemplateProfileSlice } from "./brandingPayload";
import { getEngineTemplate } from "./registry";
import { renderQrTemplateCard } from "./renderer";
import type { QrTemplateRenderInput } from "./types";

/** Build render input from existing branding pipeline + optional profile/extras. */
export function buildEngineRenderInput(opts: {
  qrUrl: string;
  templateId: string;
  branding: QrBrandingOptions;
  profile?: QrTemplateProfileSlice | null;
  extras?: Pick<
    QrStudioDesignExtras,
    | "ctaText"
    | "websiteUrl"
    | "socialInstagram"
    | "socialFacebook"
    | "templateFieldVisibility"
    | "showVenueLogoHeader"
    | "logoSize"
    | "logoOrientation"
    | "logoAlignment"
    | "logoPadding"
  > | null;
  scale?: QrTemplateRenderInput["scale"];
  smoothScale?: QrTemplateRenderInput["smoothScale"];
}): QrTemplateRenderInput | null {
  const def = getEngineTemplate(opts.templateId);
  if (!def) return null;
  const payload = buildQrTemplateBrandingPayload({
    branding: opts.branding,
    profile: opts.profile,
    extras: opts.extras,
    template: def,
  });
  return {
    qrUrl: opts.qrUrl,
    templateId: def.id,
    payload,
    scale: opts.scale,
    smoothScale: opts.smoothScale,
  };
}

export async function renderEngineTemplateFromBranding(
  qrUrl: string,
  branding: QrBrandingOptions,
  opts?: {
    profile?: QrTemplateProfileSlice | null;
    extras?: Pick<
      QrStudioDesignExtras,
      | "ctaText"
      | "websiteUrl"
      | "socialInstagram"
      | "socialFacebook"
      | "templateFieldVisibility"
      | "showVenueLogoHeader"
      | "logoSize"
      | "logoOrientation"
      | "logoAlignment"
      | "logoPadding"
    > | null;
    scale?: QrTemplateRenderInput["scale"];
    smoothScale?: QrTemplateRenderInput["smoothScale"];
  },
): Promise<HTMLCanvasElement | null> {
  const templateId = branding.qrTemplate;
  if (!templateId) return null;
  const input = buildEngineRenderInput({
    qrUrl,
    templateId,
    branding,
    profile: opts?.profile,
    extras: opts?.extras,
    scale: opts?.scale,
    smoothScale: opts?.smoothScale,
  });
  if (!input) return null;
  return renderQrTemplateCard(input);
}
