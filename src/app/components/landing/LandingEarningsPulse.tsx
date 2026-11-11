import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const TARGET_EUR = 284;
const TICK_MS = 48;

type LandingEarningsPulseProps = {
  className?: string;
};

export function LandingEarningsPulse({ className }: LandingEarningsPulseProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [amount, setAmount] = useState(reduceMotion ? TARGET_EUR : 0);

  useEffect(() => {
    if (reduceMotion) {
      setAmount(TARGET_EUR);
      return;
    }
    let frame = 0;
    const steps = 28;
    const timer = window.setInterval(() => {
      frame += 1;
      const progress = frame / steps;
      setAmount(Math.round(TARGET_EUR * progress));
      if (frame >= steps) window.clearInterval(timer);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [reduceMotion]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: 0.15 }}
      role="status"
      aria-label={t("landing.earningsPulse.aria")}
      className={cn(
        "w-fit max-w-[min(calc(100%-1.25rem),11rem)] shrink-0",
        "rounded-xl border border-white/85 bg-white/90 px-2.5 py-2",
        "shadow-[0_2px_8px_rgba(15,15,15,0.08),0_8px_20px_rgba(15,15,15,0.1)]",
        "ring-1 ring-neutral-900/[0.05] max-md:bg-white/96 md:backdrop-blur-sm",
        "dark:border-neutral-600/75 dark:bg-neutral-900/88 dark:ring-white/[0.08]",
        "dark:shadow-[0_6px_24px_rgba(0,0,0,0.4)]",
        "sm:max-w-[15rem] sm:rounded-2xl sm:px-3.5 sm:py-3",
        className,
      )}
    >
      <div className="flex items-start gap-2 sm:gap-2.5">
        <span
          className="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_0_2px_rgba(235,153,44,0.28)] sm:mt-1.5 sm:h-2 sm:w-2 sm:shadow-[0_0_0_3px_rgba(235,153,44,0.25)]"
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase leading-none tracking-[0.12em] text-neutral-500 dark:text-neutral-400 sm:text-[10px] sm:tracking-[0.14em]">
            {t("landing.earningsPulse.label")}
          </p>
          <p className="mt-0.5 tabular-nums text-xl font-bold leading-none tracking-tight text-neutral-900 dark:text-neutral-50 sm:mt-1 sm:text-[1.75rem]">
            €{amount}
          </p>
          <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold leading-none text-primary sm:mt-1.5 sm:gap-1.5 sm:text-xs">
            <TrendingUp className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" strokeWidth={2.5} aria-hidden />
            <span className="truncate">{t("landing.earningsPulse.delta")}</span>
          </p>
        </div>
      </div>
    </motion.div>
  );
}
