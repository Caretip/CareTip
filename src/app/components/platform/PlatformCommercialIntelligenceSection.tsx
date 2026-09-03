import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Loader2, CheckCircle2, CircleDashed, Info } from "lucide-react";
import {
  fetchPlatformCommercialIntelligence,
  type PlatformCommercialIntelligence,
  type PlatformCommercialBusinessInsight,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { platformUi } from "./platformDashboardUi";

const COMMERCIAL_FETCH_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((err: unknown) => {
        window.clearTimeout(timer);
        reject(err);
      });
  });
}

function SegmentList({
  title,
  items,
  emptyLabel,
  variant,
}: {
  title: string;
  items: PlatformCommercialBusinessInsight[];
  emptyLabel: string;
  variant: "growth" | "risk" | "opportunity" | "enterprise";
}) {
  const { t } = useTranslation();
  const border =
    variant === "growth"
      ? "border-emerald-500/30"
      : variant === "risk"
        ? "border-amber-500/30"
        : variant === "enterprise"
          ? "border-violet-500/30"
          : "border-primary/30";

  return (
    <div className={cn("rounded-xl border bg-muted/10 p-4", border)}>
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={`${item.segment}-${item.businessId}`} className="text-sm">
              <Link
                to={`/platform-admin/businesses/${item.businessId}`}
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                {item.name}
              </Link>
              <span className="ml-2 text-xs uppercase text-muted-foreground">{item.tier}</span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(`admin.commercial.reasons.${item.reasonCode}`, {
                  defaultValue: item.reasonCode,
                  ...item.evidence,
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EnterpriseCapabilityCard({
  readiness,
}: {
  readiness: PlatformCommercialIntelligence["enterpriseReadiness"];
}) {
  const { t } = useTranslation();
  const available = readiness.checks.filter((c) => c.passed);
  const planned = readiness.checks.filter((c) => !c.passed);
  const progressPct =
    readiness.maxScore > 0 ? Math.round((readiness.score / readiness.maxScore) * 100) : 0;

  return (
    <div className="rounded-lg border border-border/70 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground">
              {t("admin.commercial.enterprisePlanReadiness")}
            </h4>
            <span className="text-xs font-medium text-muted-foreground">
              {t("admin.commercial.enterpriseReadinessBadge")}
            </span>
          </div>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t("admin.commercial.enterpriseReadinessHelper")}
          </p>
        </div>
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          title={t("admin.commercial.enterpriseReadinessHelper")}
          aria-hidden
        >
          <Info className="h-4 w-4" />
        </span>
      </div>

      <div className="mt-4 rounded-lg border border-border/50 bg-background/80 px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground">
          {t("admin.commercial.enterpriseProgressLabel")}
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {t("admin.commercial.enterpriseProgressCount", {
            completed: readiness.score,
            total: readiness.maxScore,
          })}
        </p>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={readiness.score}
          aria-valuemin={0}
          aria-valuemax={readiness.maxScore}
          aria-label={t("admin.commercial.enterpriseProgressCount", {
            completed: readiness.score,
            total: readiness.maxScore,
          })}
        >
          <div
            className="h-full rounded-sm bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">{progressPct}%</p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="enterprise-capabilities-available">
          <h5
            id="enterprise-capabilities-available"
            className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400"
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("admin.commercial.enterpriseAvailableHeading")}
          </h5>
          {available.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("admin.commercial.enterpriseNoneAvailable")}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {available.map((check) => (
                <li key={check.id} className="flex items-start gap-2 text-sm text-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                  <span>
                    {t(`admin.commercial.enterpriseChecks.${check.id}`, { defaultValue: check.label })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="enterprise-capabilities-planned">
          <h5
            id="enterprise-capabilities-planned"
            className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400"
          >
            <CircleDashed className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("admin.commercial.enterprisePlannedHeading")}
          </h5>
          {planned.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("admin.commercial.enterpriseNonePlanned")}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {planned.map((check) => (
                <li key={check.id} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
                  <span>
                    {t(`admin.commercial.enterpriseChecks.${check.id}`, { defaultValue: check.label })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function CommercialIntelligenceBody({
  data,
}: {
  data: PlatformCommercialIntelligence;
}) {
  const { t } = useTranslation();
  const sub = data.subscription;
  const readiness = data.enterpriseReadiness;

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-semibold text-foreground">{t("admin.commercial.subscriptionTitle")}</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("admin.commercial.subscriptionPeriod", { days: sub.periodDays })}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: t("admin.commercial.upgrades"), value: sub.upgrades },
            { label: t("admin.commercial.downgrades"), value: sub.downgrades },
            { label: t("admin.commercial.cancellationsScheduled"), value: sub.cancellationsScheduled },
            { label: t("admin.commercial.paymentFailures"), value: sub.paymentFailures },
            { label: t("admin.commercial.renewals"), value: sub.renewalsSucceeded },
            { label: t("admin.commercial.activeSubscriptions"), value: sub.activeSubscriptions },
            { label: t("admin.commercial.cancelAtPeriodEnd"), value: sub.cancelAtPeriodEnd },
            { label: t("admin.commercial.pastDue"), value: sub.pastDue },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-border/60 bg-background px-3 py-2">
              <p className="text-[11px] font-medium text-muted-foreground">{m.label}</p>
              <p className="text-xl font-semibold tabular-nums">{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SegmentList
          title={t("admin.commercial.growthCandidates")}
          items={data.segments.growthCandidates}
          emptyLabel={t("admin.commercial.none")}
          variant="growth"
        />
        <SegmentList
          title={t("admin.commercial.atRisk")}
          items={data.segments.atRisk}
          emptyLabel={t("admin.commercial.none")}
          variant="risk"
        />
        <SegmentList
          title={t("admin.commercial.premiumOpportunities")}
          items={data.segments.premiumOpportunities}
          emptyLabel={t("admin.commercial.none")}
          variant="opportunity"
        />
        <SegmentList
          title={t("admin.commercial.enterpriseCandidates")}
          items={data.segments.enterpriseCandidates}
          emptyLabel={t("admin.commercial.none")}
          variant="enterprise"
        />
      </div>

      <EnterpriseCapabilityCard readiness={readiness} />
    </div>
  );
}

export function PlatformCommercialIntelligenceSection({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const [data, setData] = useState<PlatformCommercialIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await withTimeout(fetchPlatformCommercialIntelligence(), COMMERCIAL_FETCH_TIMEOUT_MS);
      setData(d);
    } catch (err) {
      setData(null);
      const devDetail =
        import.meta.env.DEV && err instanceof Error && err.message === "timeout"
          ? "Request timed out after 20s"
          : import.meta.env.DEV
            ? toUserFriendlyMessage(err)
            : null;
      setLoadError(devDetail ?? t("admin.commercial.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    if (embedded) {
      return (
        <div className="flex min-h-[88px] items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">{t("admin.networkHero.checking")}</span>
        </div>
      );
    }
    return (
      <Card className={cn(platformUi.contentCard, "mb-6")}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("admin.commercial.title")}</CardTitle>
          <CardDescription>{t("admin.commercial.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-[88px] items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          <span className="sr-only">{t("admin.networkHero.checking")}</span>
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    if (embedded) {
      return (
        <div className="flex flex-col items-start gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("admin.retry")}
          </button>
        </div>
      );
    }
    return (
      <Card className={cn(platformUi.contentCard, "mb-6")}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("admin.commercial.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("admin.retry")}
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  if (embedded) {
    return <CommercialIntelligenceBody data={data} />;
  }

  return (
    <Card className={cn(platformUi.contentCard, "mb-6")}>
      <CardHeader>
        <CardTitle className="text-base">{t("admin.commercial.title")}</CardTitle>
        <CardDescription>{t("admin.commercial.desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <CommercialIntelligenceBody data={data} />
      </CardContent>
    </Card>
  );
}
