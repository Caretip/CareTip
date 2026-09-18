import {
  BarChart3,
  Coins,
  Star,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import type { CountUpMetricKind } from "@/app/components/dashboard/CountUpMetric";

export type ActivityCardId =
  | "tip"
  | "review"
  | "dashboard"
  | "goal"
  | "shift";

export type ActivityCardEmphasis = "primary" | "standard" | "compact";

export type ActivityTitleMetric = {
  value: number;
  kind: CountUpMetricKind;
  /** i18n key for text before the animated value */
  beforeKey?: string;
  /** i18n key for text after the animated value */
  afterKey?: string;
};

export type ActivityCardSpec = {
  id: ActivityCardId;
  Icon: LucideIcon;
  badgeKey: string;
  titleKey: string;
  metaKey: string;
  timeKey: string;
  accentClass: string;
  emphasis: ActivityCardEmphasis;
  groupEnd?: boolean;
  showLive?: boolean;
  showSyncDot?: boolean;
  titleMetric?: ActivityTitleMetric;
  mobilePrimary: "badge" | "title";
  mobileSecondary: "title" | "meta";
};

export const MOTIVATION_ACTIVITY_CARD_SPECS: ActivityCardSpec[] = [
  {
    id: "tip",
    Icon: Coins,
    badgeKey: "landing.motivation.cards.tip.badge",
    titleKey: "landing.motivation.cards.tip.title",
    metaKey: "landing.motivation.cards.tip.meta",
    timeKey: "landing.motivation.cards.tip.time",
    accentClass: "caretip-motivation-activity__icon--tip",
    emphasis: "primary",
    showLive: true,
    titleMetric: {
      value: 18,
      kind: "eur",
      afterKey: "landing.motivation.cards.tip.titleAfter",
    },
    mobilePrimary: "title",
    mobileSecondary: "meta",
  },
  {
    id: "review",
    Icon: Star,
    badgeKey: "landing.motivation.cards.review.badge",
    titleKey: "landing.motivation.cards.review.title",
    metaKey: "landing.motivation.cards.review.meta",
    timeKey: "landing.motivation.cards.review.time",
    accentClass: "caretip-motivation-activity__icon--review",
    emphasis: "standard",
    groupEnd: true,
    mobilePrimary: "title",
    mobileSecondary: "meta",
  },
  {
    id: "dashboard",
    Icon: BarChart3,
    badgeKey: "landing.motivation.cards.dashboard.badge",
    titleKey: "landing.motivation.cards.dashboard.title",
    metaKey: "landing.motivation.cards.dashboard.meta",
    timeKey: "landing.motivation.cards.dashboard.time",
    accentClass: "caretip-motivation-activity__icon--dashboard",
    emphasis: "standard",
    showSyncDot: true,
    titleMetric: {
      value: 24,
      kind: "percent",
      beforeKey: "landing.motivation.cards.dashboard.metaBefore",
      afterKey: "landing.motivation.cards.dashboard.metaAfter",
    },
    mobilePrimary: "title",
    mobileSecondary: "meta",
  },
  {
    id: "goal",
    Icon: Target,
    badgeKey: "landing.motivation.cards.goal.badge",
    titleKey: "landing.motivation.cards.goal.title",
    metaKey: "landing.motivation.cards.goal.meta",
    timeKey: "landing.motivation.cards.goal.time",
    accentClass: "caretip-motivation-activity__icon--goal",
    emphasis: "standard",
    groupEnd: true,
    titleMetric: {
      value: 2400,
      kind: "eur-whole",
      beforeKey: "landing.motivation.cards.goal.titleBefore",
    },
    mobilePrimary: "title",
    mobileSecondary: "meta",
  },
  {
    id: "shift",
    Icon: TrendingUp,
    badgeKey: "landing.motivation.cards.shift.badge",
    titleKey: "landing.motivation.cards.shift.title",
    metaKey: "landing.motivation.cards.shift.meta",
    timeKey: "landing.motivation.cards.shift.time",
    accentClass: "caretip-motivation-activity__icon--shift",
    emphasis: "compact",
    titleMetric: {
      value: 18,
      kind: "percent",
      beforeKey: "landing.motivation.cards.shift.metaBefore",
      afterKey: "landing.motivation.cards.shift.metaAfter",
    },
    mobilePrimary: "title",
    mobileSecondary: "meta",
  },
];
