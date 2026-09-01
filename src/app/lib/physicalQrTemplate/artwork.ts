import originalThumb from "@/assets/physical-qr/display/caretip-a5-artwork.thumb.webp";
import originalPreview from "@/assets/physical-qr/display/caretip-a5-artwork.preview.webp";
import classicThumb from "@/assets/physical-qr/display/caretip_classic.thumb.webp";
import classicPreview from "@/assets/physical-qr/display/caretip_classic.preview.webp";
import lightThumb from "@/assets/physical-qr/display/caretip-light.thumb.webp";
import lightPreview from "@/assets/physical-qr/display/caretip-light.preview.webp";
import midnightThumb from "@/assets/physical-qr/display/caretip-midnight.thumb.webp";
import midnightPreview from "@/assets/physical-qr/display/caretip-midnight.preview.webp";
import natureThumb from "@/assets/physical-qr/display/caretip-nature.thumb.webp";
import naturePreview from "@/assets/physical-qr/display/caretip-nature.preview.webp";
import {
  PHYSICAL_QR_TEMPLATE_CLASSIC_ID,
  PHYSICAL_QR_TEMPLATE_ID,
  PHYSICAL_QR_TEMPLATE_LIGHT_ID,
  PHYSICAL_QR_TEMPLATE_MIDNIGHT_ID,
  PHYSICAL_QR_TEMPLATE_NATURE_ID,
} from "./types";

/** Dashboard display only. Print masters stay on disk for the print pipeline. */
export type PhysicalQrArtworkDisplay = "thumb" | "preview";

type ArtworkPair = { thumb: string; preview: string };

const ARTWORK_SRC: Record<string, ArtworkPair> = {
  [PHYSICAL_QR_TEMPLATE_ID]: { thumb: originalThumb, preview: originalPreview },
  [PHYSICAL_QR_TEMPLATE_CLASSIC_ID]: { thumb: classicThumb, preview: classicPreview },
  [PHYSICAL_QR_TEMPLATE_LIGHT_ID]: { thumb: lightThumb, preview: lightPreview },
  [PHYSICAL_QR_TEMPLATE_MIDNIGHT_ID]: { thumb: midnightThumb, preview: midnightPreview },
  [PHYSICAL_QR_TEMPLATE_NATURE_ID]: { thumb: natureThumb, preview: naturePreview },
};

/** Bundled display artwork URLs keyed by allowlisted template ID. Never uses a client path. */
export function physicalQrArtworkSrc(
  templateId: string | null | undefined,
  display: PhysicalQrArtworkDisplay = "preview",
): string {
  const id = String(templateId ?? "").trim();
  const pair = ARTWORK_SRC[id] ?? ARTWORK_SRC[PHYSICAL_QR_TEMPLATE_ID] ?? {
    thumb: originalThumb,
    preview: originalPreview,
  };
  return display === "thumb" ? pair.thumb : pair.preview;
}
