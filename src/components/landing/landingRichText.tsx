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