/**
 * EAS build profile → Android package / app identity.
 * Uses EAS_BUILD_PROFILE (set automatically on EAS Build workers).
 */

/** @typedef {"development" | "release"} AppVariant */

const PRODUCTION_ANDROID_PACKAGE = "de.caretip.app";
const DEVELOPMENT_ANDROID_PACKAGE = "de.caretip.app.dev";
const PRODUCTION_IOS_BUNDLE = "de.caretip.app";
const DEVELOPMENT_IOS_BUNDLE = "de.caretip.app.dev";
const PRODUCTION_APP_NAME = "CareTip";
const DEVELOPMENT_APP_NAME = "CareTip Dev";
const PRODUCTION_SCHEME = "caretip";
const DEVELOPMENT_SCHEME = "caretip-dev";

/**
 * @returns {AppVariant}
 */
function resolveAppVariant() {
  const profile = (process.env.EAS_BUILD_PROFILE ?? "").trim().toLowerCase();
  if (profile === "development") return "development";
  return "release";
}

/**
 * @param {AppVariant} variant
 */
function resolveAndroidPackage(variant) {
  return variant === "development" ? DEVELOPMENT_ANDROID_PACKAGE : PRODUCTION_ANDROID_PACKAGE;
}

/**
 * @param {AppVariant} variant
 */
function resolveIosBundleIdentifier(variant) {
  return variant === "development" ? DEVELOPMENT_IOS_BUNDLE : PRODUCTION_IOS_BUNDLE;
}

/**
 * @param {AppVariant} variant
 */
function resolveAppName(variant) {
  return variant === "development" ? DEVELOPMENT_APP_NAME : PRODUCTION_APP_NAME;
}

/**
 * @param {AppVariant} variant
 */
function resolveAppScheme(variant) {
  return variant === "development" ? DEVELOPMENT_SCHEME : PRODUCTION_SCHEME;
}

/**
 * @param {unknown} intentFilters
 * @param {string} scheme
 */
function mapIntentFilters(intentFilters, scheme) {
  if (!Array.isArray(intentFilters)) return intentFilters;
  return intentFilters.map((filter) => {
    if (!filter || typeof filter !== "object") return filter;
    const entry = /** @type {Record<string, unknown>} */ ({ ...filter });
    if (!Array.isArray(entry.data)) return entry;
    entry.data = entry.data.map((item) => {
      if (!item || typeof item !== "object") return item;
      const data = /** @type {Record<string, unknown>} */ ({ ...item });
      if (data.scheme === PRODUCTION_SCHEME || data.scheme === DEVELOPMENT_SCHEME) {
        data.scheme = scheme;
      }
      return data;
    });
    return entry;
  });
}

module.exports = {
  PRODUCTION_ANDROID_PACKAGE,
  DEVELOPMENT_ANDROID_PACKAGE,
  resolveAppVariant,
  resolveAndroidPackage,
  resolveIosBundleIdentifier,
  resolveAppName,
  resolveAppScheme,
  mapIntentFilters,
};
