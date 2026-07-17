import type { ImgHTMLAttributes } from "react";
import { ArrowRight, BellRing, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import hw04 from "../../../../images/hw04.webp";
import hw05 from "../../../../images/hw05.webp";
import hw07 from "../../../../images/hw07.webp";
import { cn } from "@/lib/utils";

type HowItWorksHeroVisualProps = {
  className?: string;
};

export function HowItWorksHeroVisual({ className }: HowItWorksHeroVisualProps) {
  const { t } = useTranslation();
  const mock = "staticPages.howItWorks.mock";

  return (
    <div
      className={cn(
        "caretip-how-hero-v2__visual caretip-how-hero-v2__anim caretip-how-hero-v2__visual-enter",
        className,
      )}
      style={{ animationDelay: "110ms" }}
      aria-hidden
    >
      <div className="caretip-how-hero-v2__visual-glow" />
      <div className="caretip-how-hero-v2__visual-grid">
        <div className="caretip-how-hero-v2__visual-stage caretip-how-hero-v2__float-y">
          <div className="caretip-how-hero-v2__visual-node">
            <img
              src={hw04}
              alt=""
              className="caretip-how-hero-v2__visual-img"
              loading="eager"
              {...({ fetchpriority: "high" } as ImgHTMLAttributes<HTMLImageElement>)}
            />
            <span className="caretip-how-hero-v2__visual-caption">{t(`${mock}.qrTable`)}</span>
          </div>
          <ArrowRight className="caretip-how-hero-v2__visual-arrow" strokeWidth={2} aria-hidden />
          <div className="caretip-how-hero-v2__visual-node caretip-how-hero-v2__visual-node--phone">
            <img
              src={hw05}
              alt=""
              className="caretip-how-hero-v2__visual-img"
              loading="eager"
              decoding="async"
            />
            <span className="caretip-how-hero-v2__visual-caption">{t("staticPages.howItWorks.visual.customerTip")}</span>
          </div>
          <ArrowRight className="caretip-how-hero-v2__visual-arrow" strokeWidth={2} aria-hidden />
          <div className="caretip-how-hero-v2__visual-node">
            <img
              src={hw07}
              alt=""
              className="caretip-how-hero-v2__visual-img"
              loading="eager"
              decoding="async"
            />
            <span className="caretip-how-hero-v2__visual-caption">{t("staticPages.howItWorks.visual.analytics")}</span>
          </div>
        </div>

        <div className="caretip-how-hero-v2__visual-float caretip-how-hero-v2__visual-float--pay caretip-how-hero-v2__float-y caretip-how-hero-v2__float-y--slow">
          <CheckCircle2 className="size-4 text-primary" strokeWidth={2.2} aria-hidden />
          <div className="min-w-0">
            <p className="caretip-how-hero-v2__visual-float-title">{t(`${mock}.paymentSuccess`)}</p>
            <p className="caretip-how-hero-v2__visual-float-value">{t(`${mock}.tipPaid`)}</p>
          </div>
        </div>

        <div className="caretip-how-hero-v2__visual-float caretip-how-hero-v2__visual-float--tip caretip-how-hero-v2__float-y caretip-how-hero-v2__float-y--reverse">
          <BellRing className="size-4 text-primary" strokeWidth={2.2} aria-hidden />
          <div className="min-w-0">
            <p className="caretip-how-hero-v2__visual-float-title">{t(`${mock}.tipReceivedTitle`)}</p>
            <p className="caretip-how-hero-v2__visual-float-value">{t(`${mock}.tipAmount`)}</p>
          </div>
        </div>

        <div className="caretip-how-hero-v2__visual-float caretip-how-hero-v2__visual-float--metric caretip-how-hero-v2__float-y">
          <p className="caretip-how-hero-v2__visual-float-kicker">{t(`${mock}.metricTips`)}</p>
          <p className="caretip-how-hero-v2__visual-float-value">{t(`${mock}.earningsValue`)}</p>
        </div>
      </div>
    </div>
  );
}
