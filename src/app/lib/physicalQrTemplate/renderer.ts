import { mergePhysicalQrColorTokens } from "./colors";
import { renderPhysicalQrSvg } from "./svg";
import type { PhysicalQrColorTokens, PhysicalQrRenderInput } from "./types";

export type PhysicalQrPreviewModel = {
  businessName: string;
  address: string | null;
  supportsAddress: boolean;
  colorTokens?: Partial<PhysicalQrColorTokens> | null;
  qrDataUrl: string | null;
  artworkDataUrl?: string | null;
};

export function buildPhysicalQrRenderInput(model: PhysicalQrPreviewModel): PhysicalQrRenderInput {
  return {
    qrDataUrl: model.qrDataUrl,
    businessName: model.businessName,
    address: model.supportsAddress ? model.address : null,
    supportsAddress: model.supportsAddress,
    colorTokens: mergePhysicalQrColorTokens(model.colorTokens),
    artworkDataUrl: model.artworkDataUrl,
  };
}

/** Live SVG markup for Branding preview — not a CSS card or html2canvas capture. */
export function renderPhysicalQrPreviewSvg(model: PhysicalQrPreviewModel): string {
  return renderPhysicalQrSvg(buildPhysicalQrRenderInput(model));
}
