import originalThumb from "@/assets/physical-qr/display/caretip-a5-artwork.thumb.webp";
import originalPreview from "@/assets/physical-qr/display/caretip-a5-artwork.preview.webp";
import { PHYSICAL_QR_TEMPLATE_ID } from "./types";

/** Dashboard display only. Print masters stay on disk for the print pipeline. */
export type PhysicalQrArtworkDisplay = "thumb" | "preview";

type ArtworkPair = { thumb: string; preview: string };

const ARTWORK_SRC: Record<string, ArtworkPair> = {
  [PHYSICAL_QR_TEMPLATE_ID]: { thumb: originalThumb, preview: originalPreview },
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
