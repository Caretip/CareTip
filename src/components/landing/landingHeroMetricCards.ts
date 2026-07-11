import {
  CheckCircle2,
  Star,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

export type HeroMetricCardId = "card-a" | "card-b";

export type HeroMetricCardSpec = {
  slot: HeroMetricCardId;
  icon: LucideIcon;
  titleKey: string;
  subtitleKey: string;
};

export type HeroSlideMetricKey = "wyc" | "wyo";

/** Contextual floating metrics per hero story frame. */
export const HERO_SLIDE_METRIC_CARDS: Record<HeroSlideMetricKey, readonly HeroMetricCardSpec[]> = {
  /** Customer tipping moment — phone, QR stand, and guest payment. */
  wyo: [
    {
      slot: "card-a",
      icon: CheckCircle2,
      titleKey: "landing.showcase.heroMetricCards.wyo.tipSent.title",
      subtitleKey: "landing.showcase.heroMetricCards.wyo.tipSent.subtitle",
    },
    {
      slot: "card-b",
      icon: Star,
      titleKey: "landing.showcase.heroMetricCards.wyo.guestRating.title",
      subtitleKey: "landing.showcase.heroMetricCards.wyo.guestRating.subtitle",
    },
  ],
  /** Business owner — dashboard and team analytics near laptop. */
  wyc: [
    {
      slot: "card-a",
      icon: TrendingUp,
      titleKey: "landing.showcase.heroMetricCards.wyc.revenue.title",
      subtitleKey: "landing.showcase.heroMetricCards.wyc.revenue.subtitle",
    },
    {
      slot: "card-b",
      icon: Users,
      titleKey: "landing.showcase.heroMetricCards.wyc.teamTips.title",
      subtitleKey: "landing.showcase.heroMetricCards.wyc.teamTips.subtitle",
    },
  ],
};

export function resolveHeroSlideMetricCards(
  frameKey: string,
): readonly HeroMetricCardSpec[] {
  if (frameKey in HERO_SLIDE_METRIC_CARDS) {
    return HERO_SLIDE_METRIC_CARDS[frameKey as HeroSlideMetricKey];
  }
  return HERO_SLIDE_METRIC_CARDS.wyc;
}
