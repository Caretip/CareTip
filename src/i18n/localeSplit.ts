/**
 * The locale files (`locales/de.json`, `locales/en.json`) stay one file per language for translators.
 * At build time they are served in two parts (Vite plugin `caretip-locale-parts` in vite.config.ts):
 *
 * - `core`: everything the public homepage, navigation, auth, cookie banner and guest tipping flow use.
 * - `app`: the sections below — dashboards, platform admin, employee area and the legal/static pages.
 *   Together ~2/3 of each file, and none of it is shown on the homepage.
 *
 * The homepage renders with `core`; every lazy route waits for `app` (`loadRouteModuleWithRetry`), and
 * every other cold entry waits for both before React mounts (main.tsx).
 */
export const DEFERRED_LOCALE_SECTIONS = ["business", "admin", "employee", "staticPages"] as const;

export type LocalePart = "core" | "app";
