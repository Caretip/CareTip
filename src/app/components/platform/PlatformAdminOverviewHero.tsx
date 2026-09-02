import { useMemo } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { Activity } from "lucide-react";
import type { PlatformHealthResponse } from "../../lib/api";
import { platformUi } from "./platformDashboardUi";
import { PLATFORM_SYSTEM_BASE } from "./platformAdminNav";
import { cn } from "@/lib/utils";

type PlatformAdminOverviewHeroProps = {
  health: PlatformHealthResponse | null;
  adminName?: string | null;
  locale?: string;
};

function resolvePlatformStatus(health: PlatformHealthResponse | null): "operational" | "degraded" | "checking" {
  if (!health) return "checking";
  if (health.database === "online" && health.stripe === "online") return "operational";
  return "degraded";
}

export function PlatformAdminOverviewHero({ health, adminName, locale }: PlatformAdminOverviewHeroProps) {
  const { t, i18n } = useTranslation();
  const status = resolvePlatformStatus(health);
  const dateLocale = (locale ?? i18n.language)?.toLowerCase().startsWith("de") ? de : enUS;
  const nowLabel = format(new Date(), "EEEE, MMMM d · h:mm a", { locale: dateLocale });

  const statusBadge = useMemo(() => {
    if (status === "operational") {
      return {
        label: t("admin.overview.hero.statusOperational"),
        className:
          "border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-800 hover:border-emerald-500/30 hover:bg-emerald-500/[0.1] dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300",
        dot: "bg-emerald-500",
      };
    }
    if (status === "degraded") {
      return {
        label: t("admin.overview.hero.statusDegraded"),
        className:
          "border-amber-500/20 bg-amber-500/[0.07] text-amber-900 hover:border-amber-500/30 hover:bg-amber-500/[0.1] dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200",
        dot: "bg-amber-500",
      };
    }
    return {
      label: t("admin.overview.hero.statusChecking"),
      className: "border-border/80 bg-muted/40 text-muted-foreground",
      dot: "bg-muted-foreground/50 animate-pulse",
    };
  }, [status, t]);

  return (
    <section
      className={cn(platformUi.overviewHero, "platform-admin-overview-hero")}
      aria-labelledby="platform-overview-hero-title"
    >
      <div className="platform-admin-overview-hero__inner">
        <div className="platform-admin-overview-hero__grid">
          <div className="platform-admin-overview-hero__copy">
            {adminName ? (
              <p className="platform-admin-overview-hero__welcome">
                {t("admin.overview.hero.welcomeNamed", { name: adminName })}
              </p>
            ) : null}
            <h1 id="platform-overview-hero-title" className="platform-admin-overview-hero__title">
              {t("admin.overview.title")}
            </h1>
            <p className="platform-admin-overview-hero__summary">{t("admin.overview.hero.summary")}</p>
          </div>

          <div className="platform-admin-overview-hero__meta">
            <p className="platform-admin-overview-hero__datetime">
              <Activity className="platform-admin-overview-hero__datetime-icon" aria-hidden />
              <time dateTime={new Date().toISOString()}>{nowLabel}</time>
            </p>
            <Link
              to={`${PLATFORM_SYSTEM_BASE}/health`}
              className={cn("platform-admin-overview-hero__status", statusBadge.className)}
              aria-label={t("admin.overview.hero.statusLinkAria")}
            >
              <span className={cn("platform-admin-overview-hero__status-dot", statusBadge.dot)} aria-hidden />
              <span className="truncate">{statusBadge.label}</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
