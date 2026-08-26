import type { ReactElement } from "react";

/** i18n inline tags for landing copy (`<bold>…</bold>`). */
export const landingBoldComponents: Record<string, ReactElement> = {
  bold: <strong className="font-semibold text-foreground" />,
};

/** CareTip orange emphasis for key words in section headlines (`<hl>…</hl>`). */
export const landingHeadlineHighlightComponents: Record<string, ReactElement> = {
  hl: (
    <span className="bg-gradient-to-r from-[#ff9e2d] via-[#e9781c] to-[#d96810] bg-clip-text text-transparent" />
  ),
};

/**
 * Responsive composition breaks for marketing headlines.
 * - `br` — all viewports
 * - `brm` — mobile only (≤767px)
 * - `brd` — desktop/tablet only (≥768px)
 * Wording stays identical; only line composition changes.
 */
export const landingHeadlineBreakComponents: Record<string, ReactElement> = {
  br: <br />,
  brm: <br className="caretip-br--mobile" />,
  brd: <br className="caretip-br--desktop" />,
};

/** Highlight + break tags for `Trans` marketing headlines. */
export const landingHeadlineComponents: Record<string, ReactElement> = {
  ...landingHeadlineHighlightComponents,
  ...landingHeadlineBreakComponents,
};

/**
 * Strip highlight tags and normalize composition markers for AnimatedHeading.
 * `<brm/>` / `<br/>` → `\n` (mobile soft break; desktop keeps a space).
 */
export function parseLandingHeadline(raw: string): { text: string; highlight: string[] } {
  const highlight = [...raw.matchAll(/<hl>(.*?)<\/hl>/gi)].map((m) => m[1] ?? "").filter(Boolean);
  const text = raw
    .replace(/<\/?hl>/gi, "")
    .replace(/<brm\s*\/?>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<brd\s*\/?>/gi, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { text, highlight };
}
