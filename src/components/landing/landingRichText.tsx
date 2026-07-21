import type { ReactElement } from "react";

/** i18n inline tags for landing copy (`<bold>…</bold>`). */
export const landingBoldComponents: Record<string, ReactElement> = {
  bold: <strong className="font-semibold text-foreground" />,
};

/** CareTip orange emphasis for key words in section headlines (`<hl>…</hl>`). */
export const landingHeadlineHighlightComponents: Record<string, ReactElement> = {
  hl: (
    <span className="bg-gradient-to-r from-[#EB992C] via-[#E89124] to-[#D88118] bg-clip-text text-transparent" />
  ),
};