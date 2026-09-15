/**
 * Guest-facing Google / TripAdvisor review links (HTTPS only).
 * Mirrors backend/src/lib/externalReviewLinks.ts — keep validation aligned.
 */

export const INVALID_GOOGLE_PLACE_ID = "Enter a valid Google Place ID.";
export const INVALID_TRIPADVISOR_REVIEW_URL =
  "Enter a valid TripAdvisor review URL, including https://.";

export const GOOGLE_WRITE_REVIEW_BASE = "https://search.google.com/local/writereview?placeid=";

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,256}$/;

export type PublicGuestExternalReviews = {
  googleWriteReviewUrl: string | null;
  tripadvisorReviewUrl: string | null;
};

/** Location settings: missing/empty keys are unconfigured (`null`), never leftover strings. */
export function coerceLocationReviewLinkFields(loc: {
  googlePlaceId?: string | null;
  tripadvisorReviewUrl?: string | null;
}): { googlePlaceId: string | null; tripadvisorReviewUrl: string | null } {
  const place = loc.googlePlaceId;
  const trip = loc.tripadvisorReviewUrl;
  return {
    googlePlaceId: place == null || String(place).trim() === "" ? null : String(place).trim(),
    tripadvisorReviewUrl: trip == null || String(trip).trim() === "" ? null : String(trip).trim(),
  };
}

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
): { ok: true; value: string | null } | { ok: false; message: string } {
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
): { ok: true; value: string | null } | { ok: false; message: string } {
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

function isGoogleWriteReviewUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (url.hostname !== "search.google.com") return false;
    if (url.pathname !== "/local/writereview") return false;
    const placeId = url.searchParams.get("placeid");
    return Boolean(placeId && /^[A-Za-z0-9_-]{10,256}$/.test(placeId));
  } catch {
    return false;
  }
}

function isSafeHttpsUrl(raw: string, hostCheck: (host: string) => boolean): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    return hostCheck(url.hostname);
  } catch {
    return false;
  }
}

export function sanitizeGuestExternalReviews(
  raw: unknown,
): PublicGuestExternalReviews | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const googleRaw = rec.googleWriteReviewUrl;
  const tripRaw = rec.tripadvisorReviewUrl;
  const googleWriteReviewUrl =
    typeof googleRaw === "string" && isGoogleWriteReviewUrl(googleRaw) ? googleRaw : null;
  const tripadvisorReviewUrl =
    typeof tripRaw === "string" && isSafeHttpsUrl(tripRaw, isTripadvisorHostname) ? tripRaw : null;
  if (!googleWriteReviewUrl && !tripadvisorReviewUrl) return null;
  return { googleWriteReviewUrl, tripadvisorReviewUrl };
}

export type GuestReviewExperience = "external" | "caretip";

/** Single guest-UI decision: any valid public destination vs CareTip internal review. */
export function guestReviewExperience(
  reviews: unknown,
): GuestReviewExperience {
  return sanitizeGuestExternalReviews(reviews) ? "external" : "caretip";
}
