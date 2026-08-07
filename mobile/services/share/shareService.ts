/**
 * CareTip mobile ShareService — single source of truth for sharing.
 *
 * Platform routing (feature screens must not choose APIs themselves):
 * - Public URLs / text → React Native `Share.share`
 * - Local files (JSON, PNG, PDF) → `expo-sharing`
 * - Clipboard → `expo-clipboard`
 *
 * Mobile-only — do not import from web packages.
 *
 * @see ./README.md
 */

import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { config } from "@/constants/config";
import { showErrorToast, showSuccessToast } from "@/store/toastStore";
import type { BrandedQrViewerMode } from "@/types/qr";
import {
  brandedQrStorageKey,
  loadBrandedQrImageCache,
} from "@/utils/brandedQrImageCache";
import {
  emitShareAnalytics,
  type ShareAnalyticsKind,
} from "@/services/share/shareAnalytics";
import {
  isPublicHttpUrl,
  isShareCancellation,
  parseDataUriImage,
} from "@/services/share/shareUtils";
import {
  cleanupShareTempFiles,
  dataExportFileName,
  deleteCacheFile,
  shareTempFileName,
  writeCacheBase64File,
  writeCacheTextFile,
} from "@/services/share/tempFiles";

export type ShareOutcome =
  | "shared"
  | "dismissed"
  | "unavailable"
  | "copied_fallback"
  | "failed";

type ToastMessages = {
  successMessage?: string;
  errorMessage?: string;
  copiedMessage?: string;
  unavailableMessage?: string;
};

export type ShareUrlOptions = ToastMessages & {
  url: string;
  message?: string;
  dialogTitle?: string;
  fallbackToCopy?: boolean;
};

export type ShareTextOptions = ToastMessages & {
  message: string;
  dialogTitle?: string;
  fallbackToCopy?: boolean;
};

export type ShareLocalFileOptions = ToastMessages & {
  fileUri: string;
  mimeType?: string;
  dialogTitle?: string;
  uti?: string;
  deleteAfterShare?: boolean;
  /** Analytics kind override (default "file"). */
  analyticsKind?: ShareAnalyticsKind;
};

export type ShareQrImageOptions = ToastMessages & {
  dataUri?: string;
  cache?: {
    userId: string;
    mode: BrandedQrViewerMode;
    targetUrl: string;
  };
  fileName?: string;
  dialogTitle?: string;
  deleteAfterShare?: boolean;
};

/** Prevents overlapping system share sheets from rapid taps. */
let shareInFlight = false;

async function withShareLock(run: () => Promise<ShareOutcome>): Promise<ShareOutcome> {
  if (shareInFlight) {
    // Ignore second tap — do not toast or emit failure analytics.
    return "dismissed";
  }
  shareInFlight = true;
  try {
    return await run();
  } finally {
    shareInFlight = false;
  }
}

function canSharePublicUrl(url: string): boolean {
  return isPublicHttpUrl(url, {
    apiBaseUrl: config.apiUrl,
    appPublicUrl: config.appUrl || "https://caretip.de",
  });
}

function applyToasts(outcome: ShareOutcome, messages: ToastMessages): void {
  if (outcome === "shared" && messages.successMessage) {
    showSuccessToast(messages.successMessage);
    return;
  }
  if (outcome === "copied_fallback" && messages.copiedMessage) {
    showSuccessToast(messages.copiedMessage);
    return;
  }
  if (outcome === "unavailable" && messages.unavailableMessage) {
    showErrorToast(messages.unavailableMessage);
    return;
  }
  if (outcome === "failed" && messages.errorMessage) {
    showErrorToast(messages.errorMessage);
  }
}

function trackOutcome(kind: ShareAnalyticsKind, outcome: ShareOutcome): void {
  if (outcome === "shared") {
    emitShareAnalytics({ event: "share_completed", kind });
    return;
  }
  if (outcome === "dismissed") {
    emitShareAnalytics({ event: "share_cancelled", kind });
    return;
  }
  if (outcome === "copied_fallback") {
    emitShareAnalytics({ event: "share_fallback_copy", kind });
    return;
  }
  if (outcome === "failed" || outcome === "unavailable") {
    emitShareAnalytics({ event: "share_failed", kind });
  }
}

export async function copyToClipboard(text: string): Promise<void> {
  const value = text.trim();
  if (!value) {
    throw new Error("Nothing to copy.");
  }
  await Clipboard.setStringAsync(value);
}

export async function shareUrl(options: ShareUrlOptions): Promise<ShareOutcome> {
  return withShareLock(async () => {
    const kind: ShareAnalyticsKind = "url";
    emitShareAnalytics({ event: "share_started", kind });

    const url = options.url.trim();
    const fallbackToCopy = options.fallbackToCopy !== false;

    if (!canSharePublicUrl(url)) {
      const outcome: ShareOutcome = "failed";
      applyToasts(outcome, options);
      trackOutcome(kind, outcome);
      return outcome;
    }

    const message = (options.message ?? url).trim() || url;

    try {
      const result = await Share.share(
        Platform.OS === "ios"
          ? { url, message, title: options.dialogTitle }
          : { message, title: options.dialogTitle },
      );

      if (result.action === Share.dismissedAction) {
        trackOutcome(kind, "dismissed");
        return "dismissed";
      }

      const outcome: ShareOutcome = "shared";
      applyToasts(outcome, options);
      trackOutcome(kind, outcome);
      return outcome;
    } catch (error) {
      if (isShareCancellation(error)) {
        trackOutcome(kind, "dismissed");
        return "dismissed";
      }

      if (fallbackToCopy) {
        try {
          await copyToClipboard(url);
          const outcome: ShareOutcome = "copied_fallback";
          applyToasts(outcome, options);
          trackOutcome(kind, outcome);
          return outcome;
        } catch {
          // fall through
        }
      }

      const outcome: ShareOutcome = "failed";
      applyToasts(outcome, options);
      trackOutcome(kind, outcome);
      return outcome;
    }
  });
}

export async function shareText(options: ShareTextOptions): Promise<ShareOutcome> {
  return withShareLock(async () => {
    const kind: ShareAnalyticsKind = "text";
    emitShareAnalytics({ event: "share_started", kind });

    const message = options.message.trim();
    const fallbackToCopy = options.fallbackToCopy !== false;

    if (!message) {
      const outcome: ShareOutcome = "failed";
      applyToasts(outcome, options);
      trackOutcome(kind, outcome);
      return outcome;
    }

    try {
      const result = await Share.share({
        message,
        title: options.dialogTitle,
      });

      if (result.action === Share.dismissedAction) {
        trackOutcome(kind, "dismissed");
        return "dismissed";
      }

      const outcome: ShareOutcome = "shared";
      applyToasts(outcome, options);
      trackOutcome(kind, outcome);
      return outcome;
    } catch (error) {
      if (isShareCancellation(error)) {
        trackOutcome(kind, "dismissed");
        return "dismissed";
      }

      if (fallbackToCopy) {
        try {
          await copyToClipboard(message);
          const outcome: ShareOutcome = "copied_fallback";
          applyToasts(outcome, options);
          trackOutcome(kind, outcome);
          return outcome;
        } catch {
          // fall through
        }
      }

      const outcome: ShareOutcome = "failed";
      applyToasts(outcome, options);
      trackOutcome(kind, outcome);
      return outcome;
    }
  });
}

export async function shareLocalFile(options: ShareLocalFileOptions): Promise<ShareOutcome> {
  return withShareLock(async () => {
    const kind: ShareAnalyticsKind = options.analyticsKind ?? "file";
    emitShareAnalytics({ event: "share_started", kind });

    const fileUri = options.fileUri.trim();
    if (!fileUri || /^https?:\/\//i.test(fileUri)) {
      const outcome: ShareOutcome = "failed";
      applyToasts(outcome, options);
      trackOutcome(kind, outcome);
      return outcome;
    }

    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        const outcome: ShareOutcome = "unavailable";
        applyToasts(outcome, options);
        trackOutcome(kind, outcome);
        return outcome;
      }

      await Sharing.shareAsync(fileUri, {
        mimeType: options.mimeType,
        dialogTitle: options.dialogTitle,
        UTI: options.uti,
      });

      const outcome: ShareOutcome = "shared";
      applyToasts(outcome, options);
      trackOutcome(kind, outcome);
      return outcome;
    } catch (error) {
      if (isShareCancellation(error)) {
        trackOutcome(kind, "dismissed");
        return "dismissed";
      }
      const outcome: ShareOutcome = "failed";
      applyToasts(outcome, options);
      trackOutcome(kind, outcome);
      return outcome;
    } finally {
      if (options.deleteAfterShare) {
        await deleteCacheFile(fileUri);
      }
    }
  });
}

/**
 * Share branded / standard QR PNG from cache or provided data URI.
 * Does not call the branded QR network API.
 */
export async function shareQrImage(options: ShareQrImageOptions): Promise<ShareOutcome> {
  let dataUri = options.dataUri?.trim() ?? "";

  if (!dataUri && options.cache) {
    const { userId, mode, targetUrl } = options.cache;
    if (userId?.trim()) {
      const key = brandedQrStorageKey(userId, mode, targetUrl ?? "");
      const cached = await loadBrandedQrImageCache(key, userId);
      dataUri = cached?.dataUri?.trim() ?? "";
    }
  }

  if (!dataUri) {
    const outcome: ShareOutcome = "failed";
    applyToasts(outcome, options);
    emitShareAnalytics({ event: "share_failed", kind: "qr_image" });
    return outcome;
  }

  const parsed = parseDataUriImage(dataUri);
  if (!parsed) {
    const outcome: ShareOutcome = "failed";
    applyToasts(outcome, options);
    emitShareAnalytics({ event: "share_failed", kind: "qr_image" });
    return outcome;
  }

  const fileName =
    options.fileName?.trim() || shareTempFileName(`qr.${parsed.extension}`);
  let path = "";

  try {
    path = await writeCacheBase64File(fileName, parsed.base64);
    return await shareLocalFile({
      fileUri: path,
      mimeType: parsed.mimeType,
      dialogTitle: options.dialogTitle,
      deleteAfterShare: options.deleteAfterShare !== false,
      successMessage: options.successMessage,
      errorMessage: options.errorMessage,
      unavailableMessage: options.unavailableMessage,
      analyticsKind: "qr_image",
    });
  } catch {
    if (path) await deleteCacheFile(path);
    const outcome: ShareOutcome = "failed";
    applyToasts(outcome, options);
    emitShareAnalytics({ event: "share_failed", kind: "qr_image" });
    return outcome;
  }
}

/** Future PDF sharing — local file only. Hidden until product UI exists. */
export async function sharePdf(
  options: ToastMessages & {
    fileUri: string;
    dialogTitle?: string;
    deleteAfterShare?: boolean;
  },
): Promise<ShareOutcome> {
  return shareLocalFile({
    fileUri: options.fileUri,
    mimeType: "application/pdf",
    uti: "com.adobe.pdf",
    dialogTitle: options.dialogTitle,
    deleteAfterShare: options.deleteAfterShare !== false,
    successMessage: options.successMessage,
    errorMessage: options.errorMessage,
    unavailableMessage: options.unavailableMessage,
    analyticsKind: "pdf",
  });
}

export async function shareJsonExport(options: {
  data: unknown;
  dialogTitle?: string;
  successMessage?: string;
  errorMessage?: string;
  unavailableMessage?: string;
}): Promise<ShareOutcome> {
  try {
    await cleanupShareTempFiles({ includeExport: true });
    const path = await writeCacheTextFile(
      dataExportFileName(),
      JSON.stringify(options.data, null, 2),
    );
    return await shareLocalFile({
      fileUri: path,
      mimeType: "application/json",
      dialogTitle: options.dialogTitle ?? "CareTip data export",
      deleteAfterShare: false,
      successMessage: options.successMessage,
      errorMessage: options.errorMessage,
      unavailableMessage: options.unavailableMessage,
      analyticsKind: "json_export",
    });
  } catch {
    const outcome: ShareOutcome = "failed";
    applyToasts(outcome, { errorMessage: options.errorMessage });
    emitShareAnalytics({ event: "share_failed", kind: "json_export" });
    return outcome;
  }
}

/** Architecture-ready — do not expose UI until Product approves. */
export async function shareInvite(options: {
  inviteCode?: string;
  url?: string;
  message?: string;
  dialogTitle?: string;
} & ToastMessages): Promise<ShareOutcome> {
  const code = options.inviteCode?.trim();
  const url = options.url?.trim();

  if (url && canSharePublicUrl(url)) {
    const parts = [options.message?.trim() || "Join me on CareTip", url];
    if (code) parts.push(`Code: ${code}`);
    return shareUrl({
      url,
      message: parts.join("\n"),
      dialogTitle: options.dialogTitle,
      ...toastPick(options),
    });
  }

  const text = options.message?.trim() || (code ? `CareTip invite code: ${code}` : "");
  if (!text) {
    const outcome: ShareOutcome = "failed";
    applyToasts(outcome, options);
    return outcome;
  }
  return shareText({
    message: text,
    dialogTitle: options.dialogTitle,
    ...toastPick(options),
  });
}

/** Architecture-ready — do not expose UI until Product approves. */
export async function shareReferral(
  options: { url: string; message?: string; dialogTitle?: string } & ToastMessages,
): Promise<ShareOutcome> {
  return shareUrl({
    url: options.url,
    message: options.message,
    dialogTitle: options.dialogTitle,
    ...toastPick(options),
  });
}

/** Architecture-ready — do not expose UI until Product approves. */
export async function shareBusinessProfile(
  options: { url: string; businessName?: string; dialogTitle?: string } & ToastMessages,
): Promise<ShareOutcome> {
  const message = options.businessName
    ? `${options.businessName}\n${options.url.trim()}`
    : options.url;
  return shareUrl({
    url: options.url,
    message,
    dialogTitle: options.dialogTitle,
    ...toastPick(options),
  });
}

function toastPick(options: ToastMessages): ToastMessages {
  return {
    successMessage: options.successMessage,
    errorMessage: options.errorMessage,
    copiedMessage: options.copiedMessage,
    unavailableMessage: options.unavailableMessage,
  };
}

export { cleanupShareTempFiles, isPublicHttpUrl, parseDataUriImage };
export {
  setShareAnalyticsListener,
  type ShareAnalyticsEvent,
  type ShareAnalyticsKind,
  type ShareAnalyticsListener,
  type ShareAnalyticsPayload,
} from "@/services/share/shareAnalytics";
