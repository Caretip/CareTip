export type BrandedQrImageDto = {
  success: true;
  imageUrl: string;
  lastUpdated: string;
  brandingVersion: string;
  /** Present when the CareTip default template was used after branded render failure. */
  fallback?: "standard";
};

export type BrandedQrErrorDto = {
  success: false;
  message: string;
  code: string;
};
