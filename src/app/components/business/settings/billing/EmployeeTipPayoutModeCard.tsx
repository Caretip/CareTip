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
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div>
        <h3 className="text-base font-semibold">{t("business.stripe.tipRouting.title")}</h3>
        <p className="text-sm text-muted-foreground mt-1">{t("business.stripe.tipRouting.hint")}</p>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("business.stripe.tipRouting.loading")}</p>
      ) : (
        <fieldset className="space-y-3" disabled={saving}>
          <legend className="sr-only">{t("business.stripe.tipRouting.title")}</legend>
          {MODES.map((option) => (
            <label
              key={option}
              className={cn(
                "flex gap-3 rounded-xl border p-3 cursor-pointer",
                draft === option ? "border-foreground/40 bg-muted/40" : "border-border",
              )}
            >
              <input
                type="radio"
                name="employeeTipPayoutMode"
                className="mt-1"
                checked={draft === option}
                onChange={() => setDraft(option)}
              />
              <span>
                <span className="block text-sm font-medium">
                  {t(`business.stripe.tipRouting.mode.${option}.label`)}
                </span>
                <span className="block text-sm text-muted-foreground mt-0.5">
                  {t(`business.stripe.tipRouting.mode.${option}.body`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <Button type="button" onClick={() => void onSave()} disabled={loading || saving || draft === mode}>
        {saving ? t("business.stripe.tipRouting.saving") : t("business.stripe.tipRouting.save")}
      </Button>
    </section>
  );
}
