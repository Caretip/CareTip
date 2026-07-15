import { Link } from "react-router";
import { motion } from "motion/react";
import { ChevronDown } from "lucide-react";

import { CareTipLogo } from "../CareTipLogo";
import { cn } from "@/lib/utils";

type HeroNestedCardSectionProps = {
  id?: string;
  heroImageSrc: string;
  heroImageAlt: string;
  title: string;
  description: string;
  primaryCtaLabel: string;
  primaryCtaTo: string;
  secondaryCtaLabel: string;
  secondaryCtaTo: string;
};

const NAV_LINKS = [
  { name: "Products", to: "/features" },
  { name: "Solutions", to: "/how-it-works" },
  { name: "Price", to: "/pricing" },
  { name: "Resources", to: "/contact" },
] as const;

export function HeroNestedCardSection({
  id,
  heroImageSrc,
  heroImageAlt,
  title,
  description,
  primaryCtaLabel,
  primaryCtaTo,
  secondaryCtaLabel,
  secondaryCtaTo,
}: HeroNestedCardSectionProps) {
  return (
    <section id={id} className={cn("w-full bg-white pt-20 sm:pt-24", id && "scroll-mt-[80px]")}>
      <div className="caretip-container pt-10 pb-16 sm:pt-14 sm:pb-20">
        {/* Outer frame */}
        <div className="rounded-[38px] bg-[#111111] p-3 shadow-[0_30px_120px_rgba(0,0,0,0.22)] sm:p-4">
          {/* Inner card */}
          <div className="relative overflow-hidden rounded-3xl bg-white shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
            {/* Floating centered nav pill */}
            <div className="pointer-events-none absolute left-1/2 top-6 z-20 w-[min(820px,calc(100%-2.5rem))] -translate-x-1/2 sm:top-7">
              <div className="pointer-events-auto mx-auto flex w-full items-center justify-between gap-3 rounded-full bg-black px-4 py-2.5 text-white shadow-[0_18px_50px_rgba(0,0,0,0.30)] sm:px-5">
                <div className="flex items-center gap-3">
                  <div className="flex items-center rounded-xl bg-white px-2 py-1">
                    <CareTipLogo size="badge" variant="wordmark" align="left" />
                  </div>
                </div>

                <div className="hidden items-center gap-6 lg:flex">
                  {NAV_LINKS.map((l) => (
                    <Link key={l.name} to={l.to} className="text-sm font-semibold text-white/90 hover:text-white">
                      <span className="inline-flex items-center gap-1">
                        {l.name}
                        {l.name === "Solutions" || l.name === "Resources" ? (
                          <ChevronDown className="h-4 w-4 text-white/60" />
                        ) : null}
                      </span>
                    </Link>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    to="/login"
                    className="hidden rounded-full bg-transparent px-4 py-2 text-sm font-semibold text-white/90 hover:text-white lg:inline-flex"
                  >
                    Login
                  </Link>
                  <Link
                    to={primaryCtaTo}
                    className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-bold text-white shadow-md transition-colors hover:bg-primary-hover"
                  >
                    {primaryCtaLabel}
                  </Link>
                </div>
              </div>
            </div>

            {/* Split content */}
            <div className="grid grid-cols-1 lg:grid-cols-2">
              {/* Left: text */}
              <div className="relative px-8 pb-12 pt-28 sm:px-10 sm:pb-14 sm:pt-32 lg:px-12 lg:pb-16">
                <motion.h1
                  className="max-w-xl text-balance text-[clamp(2.25rem,4.5vw,3.5rem)] font-black leading-[1.02] text-black"
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                >
                  {title}
                </motion.h1>

                <motion.p
                  className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-black/65 sm:text-lg"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, ease: "easeOut", delay: 0.05 }}
                >
                  {description}
                </motion.p>

                <motion.div
                  className="mt-8 flex flex-wrap items-center gap-3"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, ease: "easeOut", delay: 0.1 }}
                >
                  <Link
                    to={primaryCtaTo}
                    className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-bold text-white shadow-[0_8px_22px_rgba(233,120,28,0.28)] transition-colors hover:bg-primary-hover"
                  >
                    {primaryCtaLabel}
                  </Link>
                  <Link
                    to={secondaryCtaTo}
                    className="inline-flex items-center justify-center rounded-full border-2 border-black/15 bg-white px-6 py-3 text-sm font-bold text-black shadow-sm transition-colors hover:bg-black/5"
                  >
                    {secondaryCtaLabel}
                  </Link>
                </motion.div>
              </div>

              {/* Right: visual block with integrated image */}
              <div className="relative min-h-[360px] overflow-hidden bg-[#e9781c] lg:min-h-[520px]">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-70"
                  style={{
                    background:
                      "radial-gradient(700px circle at 75% 35%, rgba(255,255,255,0.28), transparent 60%), radial-gradient(900px circle at 20% 80%, rgba(0,0,0,0.10), transparent 60%)",
                  }}
                />

                {/* Integrated media (clipped inside the color block) */}
                <img
                  src={heroImageSrc}
                  alt={heroImageAlt}
                  className="absolute inset-0 h-full w-full object-cover mix-blend-multiply opacity-95"
                  loading="eager"
                  decoding="async"
                />

                {/* Subtle highlight ring pattern */}
                <div aria-hidden className="pointer-events-none absolute -right-28 -top-28 h-[420px] w-[420px] rounded-full border border-white/25 bg-white/10" />
                <div aria-hidden className="pointer-events-none absolute -right-10 top-24 h-[360px] w-[360px] rounded-full border border-white/20 bg-white/5" />
                <div aria-hidden className="pointer-events-none absolute right-24 -bottom-36 h-[520px] w-[520px] rounded-full border border-white/15 bg-white/5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

