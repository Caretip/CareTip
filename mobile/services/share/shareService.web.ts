/**
 * Web stub — Expo resolves this file when bundling for web.
 * CareTip ShareService is native-only. Do not import `@/services/share` from the Vite web app.
 * If web sharing is needed later, implement a separate module with the same method names.
 */

export type ShareOutcome =
  | "shared"
  | "dismissed"
  | "unavailable"
  | "copied_fallback"
  | "failed";

export type ShareUrlOptions = {
  url: string;
  message?: string;
  dialogTitle?: string;
  fallbackToCopy?: boolean;
  successMessage?: string;
  errorMessage?: string;
  copiedMessage?: string;
  unavailableMessage?: string;
};

export type ShareTextOptions = {
  message: string;
  dialogTitle?: string;
  fallbackToCopy?: boolean;
  successMessage?: string;
  errorMessage?: string;
  copiedMessage?: string;
  unavailableMessage?: string;
};

export type ShareLocalFileOptions = {
  fileUri: string;
  mimeType?: string;
  dialogTitle?: string;
  uti?: string;
  deleteAfterShare?: boolean;
  successMessage?: string;
  errorMessage?: string;
  unavailableMessage?: string;
};

export type ShareQrImageOptions = {
  dataUri?: string;
  cache?: { userId: string; mode: "employee" | "manager"; targetUrl: string };
  fileName?: string;
  dialogTitle?: string;
  deleteAfterShare?: boolean;
  successMessage?: string;
  errorMessage?: string;
  unavailableMessage?: string;
};

function unavailable(): ShareOutcome {
  return "unavailable";
}

export async function copyToClipboard(_text: string): Promise<void> {
  throw new Error("CareTip ShareService is mobile-only.");
}

export async function shareUrl(_options: ShareUrlOptions): Promise<ShareOutcome> {
  return unavailable();
}

export async function shareText(_options: ShareTextOptions): Promise<ShareOutcome> {
  return unavailable();
}

export async function shareLocalFile(_options: ShareLocalFileOptions): Promise<ShareOutcome> {
  return unavailable();
}

export async function shareQrImage(_options: ShareQrImageOptions): Promise<ShareOutcome> {
  return unavailable();
}

export async function sharePdf(): Promise<ShareOutcome> {
  return unavailable();
}

export async function shareJsonExport(): Promise<ShareOutcome> {
  return unavailable();
}

export async function shareInvite(): Promise<ShareOutcome> {
  return unavailable();
}

export async function shareReferral(): Promise<ShareOutcome> {
  return unavailable();
}

export async function shareBusinessProfile(): Promise<ShareOutcome> {
  return unavailable();
}

export async function cleanupShareTempFiles(): Promise<void> {
  // no-op on web
}

export function isPublicHttpUrl(): boolean {
  return false;
}

export function parseDataUriImage(): null {
  return null;
}

export function setShareAnalyticsListener(): void {
  // no-op
}

export type ShareAnalyticsEvent =
  | "share_started"
  | "share_completed"
  | "share_cancelled"
  | "share_failed"
  | "share_fallback_copy";
export type ShareAnalyticsKind = string;
export type ShareAnalyticsListener = (payload: unknown) => void;
export type ShareAnalyticsPayload = {
  event: ShareAnalyticsEvent;
  kind: ShareAnalyticsKind;
};
