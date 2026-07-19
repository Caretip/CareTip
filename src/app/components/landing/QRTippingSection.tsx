import { motion } from "motion/react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Link2, Smartphone, Zap, CheckCircle } from "lucide-react";
import { LandingBorderedCard } from "@/components/ui/landing-bordered-card";
import { LandingImageFrame } from "@/components/ui/landing-image-frame";
import newly01Webp from "../../../../images/newly01.webp";
import newly01Avif from "../../../../images/newly01.avif";
import { MarketingPicture } from "@/lib/marketingPicture";
import { landingUi } from "@/components/landing/landingUi";
import { cn } from "@/lib/utils";

/** Unsplash: people at a table paying with phone / card (original left-panel image) */
const IMG_PEOPLE_PAYMENT = newly01Webp;

function InstantTipSplitIllustration() {
  return (
    <LandingImageFrame
      className="relative aspect-square min-h-[180px] w-full bg-white sm:min-h-[220px] dark:bg-neutral-900"
      role="img"
      aria-label="People at a table completing a mobile payment"
    >
      <MarketingPicture
        src={IMG_PEOPLE_PAYMENT}
        webpSrc={newly01Webp}
        avifSrc={newly01Avif}
        alt="Guests at a table paying with a phone"
        className="absolute inset-0 h-full w-full object-cover object-center"
        loading="lazy"
        decoding="async"
      />
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 sm:left-4 sm:translate-x-0">
        <span className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-bold text-accent-foreground shadow-[0_6px_18px_rgba(233,120,28,0.22)]">
          Pay
        </span>
      </div>
      <div className="absolute right-2 top-2 max-w-[min(100%,11rem)] rounded-xl border border-gray-200 bg-white p-2.5 shadow-[0_10px_28px_rgba(0,0,0,0.06)] sm:right-3 sm:top-3 sm:max-w-[13rem] sm:p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start gap-2">
          <span
            className="mt-0.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.45)]"
            aria-hidden
          />
          <p className="text-xs font-semibold leading-tight text-foreground sm:text-sm">New tip received</p>
        </div>
      </div>
    </LandingImageFrame>
  );
}

export function QRTippingSection() {
  const { t } = useTranslation();

  const features = [
    {
      icon: Link2,
      title: "Works with QR codes or link",
      description: "Print, display, or share a link to meet guests where they are.",
    },
    {
      icon: Smartphone,
      title: "No downloads required",
      description: "A web flow that feels native, without another app to install.",
    },
    {
      icon: Zap,
      title: "Fast and seamless experience",
      description: "Amount, pay, done, so service never misses a beat.",
    },
  ];

  return (
    <section id="qr-experience" className="scroll-mt-[80px] bg-white px-6 py-24 dark:bg-neutral-950">
      <div className="max-w-7xl mx-auto min-w-0">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center min-w-0">
          {/* Left: Content */}
          <motion.div
            initial={{ x: -30, opacity: 0 }}
            whileInView={{ x: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="space-y-8 min-w-0"
          >
            <div className="space-y-4">
              <span className="inline-block px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-semibold">
                Guest experience
              </span>
              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-neutral-900 dark:text-neutral-100">
                Turn every interaction
                <br />
                <span className="text-primary">into an opportunity</span>
              </h2>
              <p className="text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
                Customers scan, tip, and go. No apps, no friction.
              </p>
            </div>

            {/* Features List */}
            <div className="space-y-6">
              {features.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <motion.div
                    key={feature.title}
                    initial={{ x: -20, opacity: 0 }}
                    whileInView={{ x: 0, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    className="flex items-start gap-4"
                  >
                    <div className="caretip-marketing-icon-chip w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
                        {feature.title}
                      </h3>
                      <p className="text-neutral-600 dark:text-neutral-400">
                        {feature.description}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <div className="pt-4">
              <Link
                to="/contact?intent=demo"
                className={cn(landingUi.sectionCtaPrimary)}
              >
                {t("nav.requestDemo")}
              </Link>
            </div>
          </motion.div>

          {/* Right: Visual */}
          <motion.div
            initial={{ x: 30, opacity: 0 }}
            whileInView={{ x: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="relative min-w-0 w-full max-w-full"
            whileHover={{ y: -5 }}
          >
            <div className="relative overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.06)] dark:border-neutral-800 dark:bg-neutral-900">
              {/* Split-card visual (guest Pay ↔ staff live notification) */}
              <LandingBorderedCard
                cardClassName="min-w-0 max-w-full p-6"
              >
                <InstantTipSplitIllustration />
                <div className="mt-4 sm:mt-6 text-center px-0.5">
                  <p className="mb-1 text-sm font-semibold text-primary">Scan to tip</p>
                  <p className="text-lg sm:text-xl font-medium text-neutral-600 dark:text-neutral-400 break-words">
                    Schmidt Paul
                  </p>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">Server • Table 12</p>
                </div>
              </LandingBorderedCard>

              {/* Decorative Elements: hidden on narrow screens to avoid horizontal overflow */}
              <div className="absolute -top-6 -right-6 hidden w-24 rounded-full bg-primary/[0.08] blur-2xl opacity-90 sm:block" aria-hidden />
              <div className="absolute -bottom-6 -left-6 hidden w-32 rounded-full bg-primary/[0.06] blur-2xl opacity-90 sm:block" aria-hidden />
            </div>

            {/* Floating Badge: inline on mobile so it does not overflow the viewport */}
            <motion.div
              initial={{ y: 20, opacity: 0, scale: 0.8 }}
              whileInView={{ y: 0, opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="relative mt-4 sm:absolute sm:mt-0 sm:-bottom-6 sm:-left-6 sm:max-w-[calc(100vw-2rem)] bg-white rounded-3xl p-4 shadow-[0_10px_30px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-center gap-3">
                <div className="caretip-marketing-icon-chip w-10 h-10 rounded-2xl flex items-center justify-center">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">Typical guest flow</p>
                  <p className="text-lg font-bold text-neutral-900 dark:text-neutral-100">Under 10 seconds</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
