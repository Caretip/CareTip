import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  getEmployeeBankPayoutSchedule,
  patchEmployeeBankPayoutSchedule,
  type EmployeeBankPayoutScheduleResponse,
} from "../../lib/api";
import { PayoutWorkspacePanel } from "../finance/payout/PayoutWorkspacePanel";
import { toast } from "sonner";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { cn } from "@/lib/utils";
import {
  USER_SELECTABLE_BANK_PAYOUT_SCHEDULES,
  type UserSelectableBankPayoutSchedule,
} from "../../lib/bankPayoutScheduleUserOptions";

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

  const nextLabel =
    data?.schedule === "every_3_days" && data.nextScheduledPayoutAt
      ? t("employee.payouts.schedule.nextPayout", {
          date: new Date(data.nextScheduledPayoutAt).toLocaleString(i18n.language, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        })
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
            className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
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
                    "min-h-10 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
                    selected
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
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

        {nextLabel ? <p className="text-xs text-muted-foreground">{nextLabel}</p> : null}
      </div>
    </PayoutWorkspacePanel>
  );
}
