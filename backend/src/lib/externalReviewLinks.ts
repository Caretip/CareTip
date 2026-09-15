/**
 * Location-scoped Google / TripAdvisor review-link configuration.
 * Place ID is the Google source of truth; TripAdvisor stores an HTTPS URL.
 */

export const INVALID_GOOGLE_PLACE_ID = "Enter a valid Google Place ID." as const;
export const INVALID_TRIPADVISOR_REVIEW_URL =
  "Enter a valid TripAdvisor review URL, including https://." as const;

export const GOOGLE_WRITE_REVIEW_BASE = "https://search.google.com/local/writereview?placeid=";

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,256}$/;

export type PublicGuestExternalReviews = {
  googleWriteReviewUrl: string | null;
  tripadvisorReviewUrl: string | null;
};

function isBlank(raw: string | null | undefined): boolean {
  return raw == null || String(raw).trim() === "";
}

function hasUnsafeChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function normalizeGooglePlaceId(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; message: typeof INVALID_GOOGLE_PLACE_ID } {
  if (isBlank(raw)) return { ok: true, value: null };
  const trimmed = String(raw).trim();
  if (hasUnsafeChars(trimmed) || /\s/.test(trimmed)) {
    return { ok: false, message: INVALID_GOOGLE_PLACE_ID };
  }
  if (/[:/?#\\<>'"%]/.test(trimmed)) {
    return { ok: false, message: INVALID_GOOGLE_PLACE_ID };
  }
  if (!PLACE_ID_RE.test(trimmed)) {
    return { ok: false, message: INVALID_GOOGLE_PLACE_ID };
  }
  return { ok: true, value: trimmed };
}

export function googleWriteReviewUrlFromPlaceId(placeId: string): string {
  return `${GOOGLE_WRITE_REVIEW_BASE}${encodeURIComponent(placeId)}`;
}

export function isTripadvisorHostname(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^www\./, "");
  if (!h) return false;
  if (h === "tripadvisor.com" || h.endsWith(".tripadvisor.com")) return true;
  if (/^tripadvisor\.[a-z]{2,}(?:\.[a-z]{2})?$/.test(h)) return true;
  return false;
}

export function normalizeTripadvisorReviewUrl(
  raw: string | null | undefined,
):
  | { ok: true; value: string | null }
  | { ok: false; message: typeof INVALID_TRIPADVISOR_REVIEW_URL } {
  if (isBlank(raw)) return { ok: true, value: null };
  const trimmed = String(raw).trim();
  if (hasUnsafeChars(trimmed) || /\s/.test(trimmed)) {
    return { ok: false, message: INVALID_TRIPADVISOR_REVIEW_URL };
  }
  if (/%(?:00|0a|0d)/i.test(trimmed)) {
    return { ok: false, message: INVALID_TRIPADVISOR_REVIEW_URL };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: INVALID_TRIPADVISOR_REVIEW_URL };
  }
  if (url.protocol !== "https:") {
    return { ok: false, message: INVALID_TRIPADVISOR_REVIEW_URL };
  }
  if (url.username || url.password) {
    return { ok: false, message: INVALID_TRIPADVISOR_REVIEW_URL };
  }
  if (!isTripadvisorHostname(url.hostname)) {
    return { ok: false, message: INVALID_TRIPADVISOR_REVIEW_URL };
  }
  return { ok: true, value: url.href };
}

export function toPublicGuestExternalReviews(input: {
  googlePlaceId?: string | null;
  tripadvisorReviewUrl?: string | null;
} | null | undefined): PublicGuestExternalReviews | null {
  if (!input) return null;
  const place = normalizeGooglePlaceId(input.googlePlaceId);
  const trip = normalizeTripadvisorReviewUrl(input.tripadvisorReviewUrl);
  const googleWriteReviewUrl =
    place.ok && place.value ? googleWriteReviewUrlFromPlaceId(place.value) : null;
  const tripadvisorReviewUrl = trip.ok && trip.value ? trip.value : null;
  if (!googleWriteReviewUrl && !tripadvisorReviewUrl) return null;
  return { googleWriteReviewUrl, tripadvisorReviewUrl };
}
