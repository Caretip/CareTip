import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getEmployeeTipPayoutMode,
  patchEmployeeTipPayoutMode,
  type EmployeeTipPayoutMode,
} from "../../../../lib/api";
import { toUserFriendlyMessage } from "../../../../lib/errorMessages";
import { logClientError } from "../../../../lib/clientLog";
import { Button } from "../../../ui/button";
import { businessUi } from "../../businessDashboardUi";
import { FinanceStatusPill } from "../../../finance/FinanceStatusPill";
import { cn } from "@/lib/utils";

const MODES: EmployeeTipPayoutMode[] = ["direct_to_employee", "business_distribution"];

export function EmployeeTipPayoutModeCard() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<EmployeeTipPayoutMode>("direct_to_employee");
  const [draft, setDraft] = useState<EmployeeTipPayoutMode>("direct_to_employee");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getEmployeeTipPayoutMode()
      .then((res) => {
        if (cancelled) return;
        setMode(res.mode);
        setDraft(res.mode);
      })
      .catch((err) => {
        logClientError("EmployeeTipPayoutModeCard", err);
        toast.error(toUserFriendlyMessage(err) || t("business.stripe.tipRouting.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const onSave = async () => {
    setSaving(true);
    try {
      const res = await patchEmployeeTipPayoutMode(draft);
      setMode(res.mode);
      setDraft(res.mode);
      toast.success(t("business.stripe.tipRouting.saved"));
    } catch (err) {
      logClientError("EmployeeTipPayoutModeCard.save", err);
      toast.error(toUserFriendlyMessage(err) || t("business.stripe.tipRouting.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="employee-tip-routing-heading">
      <div>
        <h2 id="employee-tip-routing-heading" className="text-base font-semibold tracking-tight">
          {t("business.stripe.tipRouting.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("business.stripe.tipRouting.hint")}</p>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("business.stripe.tipRouting.loading")}</p>
      ) : (
        <fieldset className="grid gap-3 md:grid-cols-2" disabled={saving}>
          <legend className="sr-only">{t("business.stripe.tipRouting.title")}</legend>
          {MODES.map((option) => {
            const selected = draft === option;
            return (
              <label
                key={option}
                className={cn(
                  "relative flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
                  selected
                    ? "border-foreground/25 bg-muted/40 ring-1 ring-foreground/15"
                    : "border-border hover:border-foreground/20",
                )}
              >
                <input
                  type="radio"
                  name="employeeTipPayoutMode"
                  className="sr-only"
                  checked={selected}
                  onChange={() => setDraft(option)}
                />
                <span className="min-w-0 space-y-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold leading-snug">
                      {t(`business.stripe.tipRouting.mode.${option}.label`)}
                    </span>
                    {mode === option ? (
                      <FinanceStatusPill tone="success" label={t("business.stripe.tipRouting.active")} />
                    ) : null}
                  </span>
                  <span className="block text-sm leading-snug text-muted-foreground">
                    {t(`business.stripe.tipRouting.mode.${option}.body`)}
                  </span>
                  <span className="block text-xs leading-snug text-muted-foreground">
                    {t(`business.stripe.tipRouting.mode.${option}.note`)}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      <p className="text-xs text-muted-foreground">{t("business.stripe.tipRouting.appliesNew")}</p>
      <Button
        type="button"
        className={businessUi.btnPrimary}
        onClick={() => void onSave()}
        disabled={loading || saving || draft === mode}
      >
        {saving ? t("business.stripe.tipRouting.saving") : t("business.stripe.tipRouting.save")}
      </Button>
    </section>
  );
}
