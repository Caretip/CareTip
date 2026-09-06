/**
 * Restore landing photographs after the document is hidden.
 * Chrome often drops GPU tiles for transform/opacity stacks; scroll then
 * retriggers decode. We pause compositing work while hidden and decode on resume.
 */
export const CARETIP_DOCUMENT_HIDDEN_CLASS = "caretip-document-hidden";
export const CARETIP_LANDING_RESUME_EVENT = "caretip-landing-media-resume";

const LANDING_IMG_SELECTOR =
  ".caretip-hero-story-frame, .caretip-industry-photo-card__img";

export function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function syncDocumentHiddenClass(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(CARETIP_DOCUMENT_HIDDEN_CLASS, isDocumentHidden());
}

/** Re-decode already-complete bitmaps so compositor tiles can be rebuilt without a scroll. */
export function refreshLandingDecodedImages(root: ParentNode = document): void {
  const imgs = root.querySelectorAll<HTMLImageElement>(LANDING_IMG_SELECTOR);
  for (const img of imgs) {
    if (!img.complete || img.naturalWidth < 1) continue;
    if (typeof img.decode === "function") {
      void img.decode().catch(() => undefined);
    }
  }
}

export function dispatchLandingMediaResume(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CARETIP_LANDING_RESUME_EVENT));
}
