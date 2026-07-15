import * as React from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2,
  Scissors,
  Truck,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { Marquee } from "@/components/ui/marquee";
import { landingImageFrameClassName } from "@/components/ui/landing-image-frame";
import { cn } from "@/lib/utils";

/** Industry marquee photos — new animated set. */
import logistikImg from "../../../images/Logistik.webp";
import bedienungThekeImg from "../../../images/Bedienungs Theke.webp";
import beautySalonImg from "../../../images/Beauty Salon.webp";
import handwerkerImg from "../../../images/Handwerker.webp";
import restaurantBerlinImg from "../../../images/Restaurant berlin(1).webp";

type IndustryId = "delivery" | "hospitality" | "beauty" | "craftHome" | "restaurant";

type MarqueeSpec = {
  id: IndustryId;
  image: string;
  Icon: LucideIcon;
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
      })),
    [t, i18n.resolvedLanguage],
  );

  return (
    <div className="caretip-hospitality-marquee relative w-full overflow-hidden bg-transparent">
      <div className="caretip-hospitality-marquee__fade caretip-hospitality-marquee__fade--left" aria-hidden />
      <div className="caretip-hospitality-marquee__fade caretip-hospitality-marquee__fade--right" aria-hidden />

      <Marquee className="caretip-hospitality-marquee__track" pauseOnHover durationSeconds={72} gapPx={18}>
        {businesses.map((b, index) => (
          <div
            className="caretip-hospitality-marquee-item group flex shrink-0 flex-col"
            key={b.id}
          >
            <div
              className={cn(
                landingImageFrameClassName,
                "caretip-hospitality-marquee-card relative w-full overflow-hidden",
              )}
            >
              <img
                alt={b.name}
                className="caretip-hospitality-marquee-card__img h-full w-full object-cover object-center"
                src={b.image}
                loading={index < 3 ? "eager" : "lazy"}
                decoding="async"
                referrerPolicy="no-referrer"
                draggable={false}
              />
              <div className="caretip-hospitality-marquee-caption">
                <b.Icon className="caretip-hospitality-marquee-caption__icon" strokeWidth={1.75} aria-hidden />
                <span className="caretip-hospitality-marquee-caption__label">{b.name}</span>
              </div>
            </div>
          </div>
        ))}
      </Marquee>
    </div>
  );
}
