import { motion } from "motion/react";
import { Timer, Sparkles } from "lucide-react";
import liveWebp from "../../../../images/live-in-minutes.webp";
import liveAvif from "../../../../images/live-in-minutes.avif";
import { MarketingPicture } from "@/lib/marketingPicture";

export function LandingSpeedSection() {
  return (
    <section className="bg-white px-6 py-24 dark:bg-neutral-950">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="order-2 space-y-6 lg:order-1"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100">
            <Sparkles className="h-4 w-4 text-primary" />
            Speed
          </span>
          <h2 className="text-balance text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 sm:text-4xl md:text-5xl">
            From scan to tip in under 10 seconds
          </h2>
          <p className="max-w-lg text-pretty text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
            Guests choose an amount, pay, and move on. Your team gets the signal instantly, with no awkward waits or
            fumbling for cash.
          </p>
          <ul className="flex flex-wrap gap-3 text-sm font-medium text-neutral-600 dark:text-neutral-400">
            <li className="rounded-full bg-gray-50 px-4 py-2 ring-1 ring-gray-200 dark:bg-neutral-900 dark:ring-neutral-800">No app download</li>
            <li className="rounded-full bg-gray-50 px-4 py-2 ring-1 ring-gray-200 dark:bg-neutral-900 dark:ring-neutral-800">Works on any phone</li>
            <li className="rounded-full bg-gray-50 px-4 py-2 ring-1 ring-gray-200 dark:bg-neutral-900 dark:ring-neutral-800">Built for busy floors</li>
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative order-1 lg:order-2"
        >
          <div className="relative overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.06)] dark:border-neutral-800 dark:bg-neutral-900">
            <MarketingPicture
              src={liveWebp}
              webpSrc={liveWebp}
              avifSrc={liveAvif}
              alt="Team using CareTip on devices during service"
              className="aspect-[4/3] w-full object-cover object-center"
              loading="lazy"
              decoding="async"
            />
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.06)] backdrop-blur-sm sm:left-6 sm:right-6 sm:bottom-6 dark:border-neutral-800 dark:bg-neutral-900/95">
              <div className="flex items-center gap-3">
                <div className="caretip-marketing-icon-chip flex h-10 w-10 items-center justify-center rounded-xl">
                  <Timer className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">Typical flow</p>
                  <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">Under 10 seconds</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
