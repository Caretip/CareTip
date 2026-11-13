import type { ElementType, ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Cloud, Database, Server } from "lucide-react";
import type { PlatformHealthResponse } from "../lib/api";
import { cn } from "@/lib/utils";

export type NetworkOverviewHeroProps = {
  health: PlatformHealthResponse | null;
  /** When true, sits inside PremiumPageHero — drops outer frame styles. */
  embedded?: boolean;
  /** Render headline only, health cards only, or both (default). */
  variant?: "full" | "copy" | "health";
  /** Show derived platform API status alongside Postgres and Stripe. */
  includeApiCard?: boolean;
};

function LivePulse({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex h-3 w-3", className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60 opacity-75" />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
    </span>
  );
}

function HealthStatCard({
  icon: Icon,
  label,
  value,
  valueClassName,
  pulse,
  delay,
  iconClassName,
}: {
  icon: ElementType;
  label: string;
  value: string;
  valueClassName?: string;
  pulse?: ReactNode;
  delay: number;
  iconClassName?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: delay * 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-sm sm:px-5 sm:py-4"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
          <Icon
            className={cn("h-4 w-4 text-muted-foreground sm:h-[18px] sm:w-[18px]", iconClassName)}
            strokeWidth={2}
          />
        </div>
        <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p
          className={cn(
            "font-sans text-xl font-semibold tabular-nums tracking-tight text-foreground sm:text-2xl",
            valueClassName,
          )}
        >
          {value}
        </p>
        {pulse}
      </div>
    </motion.div>
  );
}

function statusPulse(state: "checking" | "online" | "offline"): ReactNode {
  if (state === "checking") {
    return <span className="h-3 w-3 animate-pulse rounded-full bg-muted-foreground/40" />;
  }
  if (state === "online") {
    return <LivePulse />;
  }
  return <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />;
}

function valueClass(state: "checking" | "online" | "offline"): string {
  if (state === "checking") return "text-foreground";
  if (state === "online") return "text-emerald-700 dark:text-emerald-400";
  return "text-destructive";
}

function iconTint(state: "checking" | "online" | "offline"): string {
  if (state === "checking") return "text-primary";
  if (state === "online") return "text-emerald-700 dark:text-emerald-400";
  return "text-destructive";
}

export function NetworkOverviewHero({
  health,
  embedded = false,
  variant = "full",
  includeApiCard = false,
}: NetworkOverviewHeroProps) {
  const { t } = useTranslation();
  const showCopy = variant === "full" || variant === "copy";
  const showHealth = variant === "full" || variant === "health";

  const pg = useMemo(() => {
    if (!health) return { text: t("admin.networkHero.checking"), state: "checking" as const };
    const ok = health.database === "online";
    return {
      text: ok ? t("admin.networkHero.online") : t("admin.networkHero.offline"),
      state: ok ? ("online" as const) : ("offline" as const),
    };
  }, [health, t]);

  const st = useMemo(() => {
    if (!health) return { text: t("admin.networkHero.checking"), state: "checking" as const };
    const ok = health.stripe === "online";
    return {
      text: ok ? t("admin.networkHero.online") : t("admin.networkHero.offline"),
      state: ok ? ("online" as const) : ("offline" as const),
    };
  }, [health, t]);

  const api = useMemo(() => {
    if (!health) return { text: t("admin.networkHero.checking"), state: "checking" as const };
    const ok = health.database === "online" && health.stripe === "online";
    return {
      text: ok ? t("admin.networkHero.online") : t("admin.networkHero.offline"),
      state: ok ? ("online" as const) : ("offline" as const),
    };
  }, [health, t]);

  return (
    <section
      className={cn(
        "platform-admin-hero relative",
        !embedded && "mb-6",
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-6",
          showCopy && showHealth && "lg:flex-row lg:items-end lg:justify-between lg:gap-8",
        )}
      >
        {showCopy ? (
        <div className="min-w-0 max-w-xl lg:max-w-[28rem]">
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="platform-admin-page-title font-sans text-[clamp(1.75rem,4.2vw,2.35rem)] font-bold leading-[1.08] tracking-tight text-foreground sm:leading-[1.1]"
          >
            {t("admin.networkHero.title")}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.06 }}
            className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground sm:mt-3.5 sm:text-base sm:leading-[1.65]"
          >
            <span className="lg:hidden">{t("admin.networkHero.subtitleMobile")}</span>
            <span className="hidden lg:inline">{t("admin.networkHero.subtitle")}</span>
          </motion.p>
        </div>
        ) : null}

        {showHealth ? (
        <div
          className={cn(
            "flex w-full flex-col gap-3",
            showCopy && "lg:ml-auto lg:w-auto lg:max-w-md xl:max-w-lg",
          )}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("admin.networkHero.systemHealth")}
          </p>
          <div
            className={cn(
              "grid gap-2 sm:gap-3",
              includeApiCard ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 sm:flex sm:flex-row sm:items-stretch",
            )}
          >
            <HealthStatCard
              icon={Database}
              label={t("admin.networkHero.labelPostgres")}
              value={pg.text}
              valueClassName={valueClass(pg.state)}
              iconClassName={iconTint(pg.state)}
              pulse={statusPulse(pg.state)}
              delay={0.12}
            />
            <HealthStatCard
              icon={Cloud}
              label={t("admin.networkHero.labelStripe")}
              value={st.text}
              valueClassName={valueClass(st.state)}
              iconClassName={iconTint(st.state)}
              pulse={statusPulse(st.state)}
              delay={0.2}
            />
            {includeApiCard ? (
              <HealthStatCard
                icon={Server}
                label={t("admin.networkHero.labelApi")}
                value={api.text}
                valueClassName={valueClass(api.state)}
                iconClassName={iconTint(api.state)}
                pulse={statusPulse(api.state)}
                delay={0.28}
              />
            ) : null}
          </div>
        </div>
        ) : null}
      </div>
    </section>
  );
}
