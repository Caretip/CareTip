/**
 * Started from index.html before main.tsx so the active locale JSON fetch
 * overlaps with the main module graph download (same ensureI18nReady promise).
 */
import { ensureI18nReady } from "./i18n";

export const landingI18nPreload = ensureI18nReady();
