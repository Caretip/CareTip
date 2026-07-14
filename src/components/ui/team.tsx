import * as React from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2,
  Scissors,
  Truck,
  UtensilsCrossed,
  Wrench,
} from "lucide-react";

import { Marquee } from "@/components/ui/marquee";
import { landingImageFrameClassName } from "@/components/ui/landing-image-frame";
import { landingUi } from "@/components/landing/landingUi";
import { cn } from "@/lib/utils";

/** Approved industry photos — 960×960 WebP (AVIF companions on disk). */
import logistikImg from "../../../images/Log01.webp";
import bedienungThekeImg from "../../../images/Hotels.webp";
import beautySalonImg from "../../../images/salon and spa.webp";
import handwerkerImg from "../../../images/trade and home services.webp";
import restaurantBerlinImg from "../../../images/petcare and services.webp";

type IndustryId = "delivery" | "hospitality" | "beauty" | "craftHome" | "restaurant";

type MarqueeSpec = {
  id: IndustryId;
  image: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const MARQUEE_SPECS: MarqueeSpec[] = [
  {
    id: "restaurant",
    image: restaurantBerlinImg,
    Icon: UtensilsCrossed,
  },
  {
    id: "hospitality",
    image: bedienungThekeImg,
    Icon: Building2,
  },
  {
    id: "delivery",
    image: logistikImg,
    Icon: Truck,
  },
  {
    id: "beauty",
    image: beautySalonImg,
    Icon: Scissors,
  },
  {
    id: "craftHome",
    image: handwerkerImg,
    Icon: Wrench,
  },
];

export default function HospitalityBusinessesMarquee() {
  const { t, i18n } = useTranslation();

  const businesses = useMemo(
    () =>
      MARQUEE_SPECS.map((spec) => ({
        ...spec,
        name: t(`landing.industries.${spec.id}.name`),
        role: t(`landing.industries.${spec.id}.role`),
      })),
    [t, i18n.resolvedLanguage],
  );

  return (
    <div className="caretip-hospitality-marquee relative w-full overflow-hidden bg-transparent py-7 sm:py-8">
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-16 bg-gradient-to-r from-white via-white/90 to-transparent dark:from-neutral-950 dark:via-neutral-950/80 sm:w-20" />
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-16 bg-gradient-to-l from-white via-white/90 to-transparent dark:from-neutral-950 dark:via-neutral-950/80 sm:w-20" />

      <Marquee className="[--gap:1rem]" pauseOnHover durationSeconds={65} gapPx={16}>
        {businesses.map((b, index) => (
          <div
            className="caretip-hospitality-marquee-item group flex w-[17.5rem] shrink-0 flex-col transition-transform duration-300 ease-out sm:w-[19rem]"
            key={b.id}
          >
            <div
              className={cn(
                landingImageFrameClassName,
                "caretip-hospitality-marquee-card relative aspect-[4/5] w-full rounded-[1.125rem] bg-neutral-100 shadow-[0_4px_16px_rgba(0,0,0,0.05)] transition-[transform,box-shadow] duration-300 ease-out dark:bg-neutral-900 dark:shadow-[0_6px_20px_rgba(0,0,0,0.28)]",
              )}
            >
              <img
                alt={b.name}
                className="h-full w-full object-cover object-center transition-opacity duration-300 ease-out group-hover:opacity-[0.97]"
                src={b.image}
                loading={index < 3 ? "eager" : "lazy"}
                decoding="async"
                referrerPolicy="no-referrer"
              />
              <div className="caretip-hospitality-marquee-caption absolute inset-x-0 bottom-0 border-t border-neutral-200/60 bg-white px-2.5 py-2 dark:border-neutral-800/80 dark:bg-neutral-950 sm:px-3 sm:py-2.5">
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      landingUi.brandAccentIconWrap,
                      "h-7 w-7 sm:h-8 sm:w-8",
                    )}
                  >
                    <b.Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold leading-snug text-neutral-900 dark:text-neutral-50">
                      {b.name}
                    </h3>
                    {b.role ? (
                      <p className="mt-0.5 text-xs leading-snug text-neutral-600 dark:text-neutral-400 sm:text-[13px]">
                        {b.role}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </Marquee>
    </div>
  );
}
