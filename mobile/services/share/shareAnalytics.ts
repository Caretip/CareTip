/**
 * Optional analytics hooks for ShareService.
 * Feature screens do not call these — ShareService emits events.
 * Wire a listener later (e.g. Amplitude / Segment) without touching QR UI.
 */

export type ShareAnalyticsEvent =
  | "share_started"
  | "share_completed"
  | "share_cancelled"
  | "share_failed"
  | "share_fallback_copy";

export type ShareAnalyticsKind =
  | "url"
  | "text"
  | "file"
  | "qr_image"
  | "json_export"
  | "invite"
  | "referral"
  | "business_profile"
  | "pdf"
  | "clipboard";

export type ShareAnalyticsPayload = {
  event: ShareAnalyticsEvent;
  kind: ShareAnalyticsKind;
  /** Non-sensitive metadata only — never tokens or file paths. */
  meta?: Record<string, string | number | boolean | undefined>;
};

export type ShareAnalyticsListener = (payload: ShareAnalyticsPayload) => void;

let listener: ShareAnalyticsListener | null = null;

/** Register (or clear) a global share analytics listener. */
export function setShareAnalyticsListener(next: ShareAnalyticsListener | null): void {
  listener = next;
}

export function emitShareAnalytics(payload: ShareAnalyticsPayload): void {
  if (!listener) return;
  try {
    listener(payload);
  } catch {
    // Analytics must never break sharing.
  }
}
