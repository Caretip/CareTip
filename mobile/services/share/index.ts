/**
 * CareTip ShareService public surface.
 * @see ./README.md
 */
export {
  copyToClipboard,
  shareUrl,
  shareText,
  shareLocalFile,
  shareQrImage,
  sharePdf,
  shareJsonExport,
  shareInvite,
  shareReferral,
  shareBusinessProfile,
  cleanupShareTempFiles,
  isPublicHttpUrl,
  parseDataUriImage,
  setShareAnalyticsListener,
  type ShareOutcome,
  type ShareUrlOptions,
  type ShareTextOptions,
  type ShareLocalFileOptions,
  type ShareQrImageOptions,
  type ShareAnalyticsEvent,
  type ShareAnalyticsKind,
  type ShareAnalyticsListener,
  type ShareAnalyticsPayload,
} from "@/services/share/shareService";
