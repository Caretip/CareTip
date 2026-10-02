import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchPlatformBusinessPayoutScheduleContext,
  type PlatformAdminPayoutScheduleContext,
} from "../../lib/api";
import { formatAdminFinancialDateTime } from "../../lib/adminFinancialTimezone";
import { formatConnectPayoutAmount } from "../../lib/connectPayoutDisplay";
function scheduleLabel(schedule: string, t: (k: string) => string): string {
  const map: Record<string, string> = {
    daily: "admin.payoutSchedulePanel.scheduleDaily",
    weekly: "admin.payoutSchedulePanel.scheduleWeekly",
    monthly: "admin.payoutSchedulePanel.scheduleMonthly",
    every_3_days: "admin.payoutSchedulePanel.scheduleEvery3Days",
    manual: "admin.payoutSchedulePanel.scheduleManual",
  };
  const i18nKey = map[schedule];
  if (!i18nKey) return schedule.replace(/_/g, " ");
  return t(i18nKey);
}

function executionLabel(
  label: PlatformAdminPayoutScheduleContext["business"]["executionLabel"],
  t: (k: string) => string,
): string {
  if (label === "caretip_scheduled") return t("admin.payoutSchedulePanel.executionCareTipScheduled");
  if (label === "manual_no_caretip_run") return t("admin.payoutSchedulePanel.executionManual");
  return t("admin.payoutSchedulePanel.executionStripeAutomatic");
}

type Row = PlatformAdminPayoutScheduleContext["business"];

function ScheduleRow({ row, locale }: { row: Row; locale: string }) {
  const { t } = useTranslation();
  const last =
    row.lastPayoutCreatedAt && row.lastPayoutAmountCents != null
      ? `${formatAdminFinancialDateTime(row.lastPayoutCreatedAt, locale)} · ${formatConnectPayoutAmount(row.lastPayoutAmountCents, "eur", locale)}${row.lastPayoutStatus ? ` (${row.lastPayoutStatus})` : ""}`
      : "—";

  return (
    <div className="rounded-lg border border-border/80 p-3 text-sm">
      <p className="font-medium text-foreground">{row.subjectName}</p>
      {!row.stripeAccountId ? (
        <p className="mt-1 text-muted-foreground">{t("admin.payoutSchedulePanel.notConnected")}</p>
      ) : (
        <dl className="mt-2 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <dt>{t("admin.payoutSchedulePanel.careTipSchedule")}</dt>
            <dd className="font-medium text-foreground">{scheduleLabel(row.careTipSchedule, t)}</dd>
          </div>
          <div>
            <dt>{t("admin.payoutSchedulePanel.stripeInterval")}</dt>
            <dd className="font-medium text-foreground">{row.stripeScheduleInterval ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("admin.payoutSchedulePanel.execution")}</dt>
            <dd className="font-medium text-foreground">{executionLabel(row.executionLabel, t)}</dd>
          </div>
          <div>
            <dt>{t("admin.payoutSchedulePanel.nextRun")}</dt>
            <dd className="font-medium text-foreground">
              {row.nextScheduledPayoutAt
                ? `${formatAdminFinancialDateTime(row.nextScheduledPayoutAt, locale)} (${row.timezone})`
                : "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt>{t("admin.payoutSchedulePanel.lastPayout")}</dt>
            <dd className="font-medium text-foreground">{last}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

export function PlatformBusinessPayoutSchedulePanel({ businessId }: { businessId: string }) {
  const { t, i18n } = useTranslation();
  const [ctx, setCtx] = useState<PlatformAdminPayoutScheduleContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchPlatformBusinessPayoutScheduleContext(businessId)
      .then((data) => {
        if (!cancelled) setCtx(data);
      })
      .catch(() => {
        if (!cancelled) setCtx(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return (
    <section className="rounded-lg border border-border/80 bg-muted/20 p-4">
      <h2 className="text-base font-semibold text-foreground">{t("admin.payoutSchedulePanel.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("admin.payoutSchedulePanel.subtitle")}</p>
      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("admin.globalTransactionsPage.loading")}</p>
      ) : !ctx ? (
        <p className="mt-4 text-sm text-muted-foreground">—</p>
      ) : (
        <div className="mt-4 space-y-4">
          <ScheduleRow row={ctx.business} locale={i18n.language} />
          {ctx.employees.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">
                {t("admin.payoutSchedulePanel.employees")}
              </h3>
              <div className="space-y-2">
                {ctx.employees.map((row) => (
                  <ScheduleRow key={row.subjectId} row={row} locale={i18n.language} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
