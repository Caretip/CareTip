import type multer from "multer";

/** Extra multer limits not always present on `@types/multer`. */
type MulterLimits = NonNullable<multer.Options["limits"]> & {
  fieldNestingDepth?: number;
  fieldArrayIndexLimit?: number;
};

/**
 * DoS-safe defaults for multer >= 2.3.0
 * (GHSA-72gw-mp4g-v24j, GHSA-3p4h-7m6x-2hcm, GHSA-wc9g-mqfw-jrwm, GHSA-535w-7cp7-47q4).
 * Upload routes use flat field names (`file`) — no bracket nesting or array indexes required.
 */
export const MULTER_SAFE_LIMITS: MulterLimits = {
  files: 1,
  fields: 10,
  fieldNestingDepth: 0,
  fieldArrayIndexLimit: 0,
};
