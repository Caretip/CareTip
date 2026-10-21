import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  getEmployeeBankPayoutSchedule,
  patchEmployeeBankPayoutSchedule,
  type EmployeeBankPayoutScheduleResponse,
} from "../../lib/api";
import { PayoutWorkspacePanel } from "../finance/payout/PayoutWorkspacePanel";
import {
  payoutScheduleOptionButton,
  payoutScheduleOptionGrid,
  payoutScheduleOptionState,
} from "../finance/payout/payoutWorkspaceClasses";
import { toast } from "sonner";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { cn } from "@/lib/utils";
import {
  USER_SELECTABLE_BANK_PAYOUT_SCHEDULES,
  type UserSelectableBankPayoutSchedule,
} from "../../lib/bankPayoutScheduleUserOptions";
import { formatScheduledPayoutBusinessTime } from "../../lib/scheduledPayoutBusinessTime";

const OPTIONS = USER_SELECTABLE_BANK_PAYOUT_SCHEDULES;

export function EmployeeBankPayoutScheduleCard({
  disabled,
}: {
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<EmployeeBankPayoutScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getEmployeeBankPayoutSchedule());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function selectSchedule(schedule: UserSelectableBankPayoutSchedule) {
    if (saving || disabled || data?.schedule === schedule) return;
    setSaving(true);
    try {
      const next = await patchEmployeeBankPayoutSchedule(schedule);
      setData(next);
      toast.success(t("employee.payouts.schedule.saved"));
    } catch (err) {
      toast.error(toUserFriendlyMessage(err) || t("employee.payouts.schedule.saveError"));
    } finally {
      setSaving(false);
    }
  }

  const nextPayout =
    data?.schedule === "every_3_days" && data.nextScheduledPayoutAt
      ? formatScheduledPayoutBusinessTime(
          data.nextScheduledPayoutAt,
          data.businessTimezone,
          i18n.language,
        )
      : null;
  const nextZoneLabel = nextPayout
    ? nextPayout.usesBusinessTimezone
      ? t("employee.payouts.schedule.nextPayoutZone", {
          place: nextPayout.placeName,
          zone: nextPayout.formattedTimeZone,
        })
      : t("employee.payouts.schedule.nextPayoutZoneUnavailable")
    : null;

  return (
    <PayoutWorkspacePanel className="min-w-0">
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight sm:text-base">
            {t("employee.payouts.schedule.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("employee.payouts.schedule.lead")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("employee.payouts.schedule.speedNote")}
          </p>
          {data?.settlement?.source === "unavailable" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("employee.payouts.schedule.settlementUnavailable")}
            </p>
          ) : typeof data?.settlement?.effectiveDelayDays === "number" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                data.settlement.source === "accounts_v1_fallback"
                  ? "employee.payouts.schedule.settlementNoteFallback"
                  : "employee.payouts.schedule.settlementNote",
                { days: data.settlement.effectiveDelayDays },
              )}
            </p>
          ) : null}
          {data?.lastPolicyApply && !data.lastPolicyApply.policyComplete ? (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {t("employee.payouts.schedule.policyPartialSuccess", {
                schedule: data.lastPolicyApply.schedule.status,
                settlement: data.lastPolicyApply.settlement?.status ?? "n/a",
              })}
            </p>
          ) : null}
          {data?.lastPolicyApply?.settlement?.stripeSupportMayBeRequired ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("employee.payouts.schedule.settlementStripeSupport")}
            </p>
          ) : null}
          {data?.scheduleDrift ? (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {t("employee.payouts.schedule.scheduleDriftNotice")}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {t("employee.payouts.schedule.transferNote")}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-busy="true">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("employee.payouts.schedule.loading")}
          </div>
        ) : (
          <>
          {data?.schedule === "manual" ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t("employee.payouts.schedule.legacyManualNotice")}
            </p>
          ) : null}
          <div
            className={payoutScheduleOptionGrid}
            role="radiogroup"
            aria-label={t("employee.payouts.schedule.title")}
          >
            {OPTIONS.map((option) => {
              const selected = data?.schedule === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled || saving || !data}
                  onClick={() => void selectSchedule(option)}
                  className={cn(
                    payoutScheduleOptionButton,
                    payoutScheduleOptionState(selected),
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  {t(`employee.payouts.schedule.options.${option}`)}
                </button>
              );
            })}
          </div>
          </>
        )}

        {nextPayout && nextZoneLabel ? (
          <div className="border-t border-border/70 pt-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("employee.payouts.schedule.nextPayoutLabel")}
            </p>
            <p className="mt-0.5 text-sm font-semibold tracking-tight text-foreground">
              {nextPayout.dateText}
              <span className="px-1.5 font-normal text-muted-foreground" aria-hidden>
                ·
              </span>
              {nextPayout.timeText}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{nextZoneLabel}</p>
          </div>
        ) : null}
      </div>
    </PayoutWorkspacePanel>
  );
}
