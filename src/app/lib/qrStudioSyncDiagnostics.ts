/**
 * Phase 13.8 — DEV-only diagnostics for Business branding → employee QR SSOT sync.
 * Never logs in production builds.
 */

export type QrStudioSyncEvent =
  | "branding_version"
  | "cache_invalidation"
  | "slug_ensure"
  | "employee_skipped"
  | "preview_generation"
  | "pdf_generation"
  | "png_generation"
  | "regeneration_complete";

export function logQrStudioSync(
  event: QrStudioSyncEvent,
  payload: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return;
  console.info(`[qr-studio-sync] ${event}`, payload);
}
