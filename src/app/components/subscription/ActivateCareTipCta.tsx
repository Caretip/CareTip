import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "@/app/lib/globalAppLoading";
import {
  activationCheckoutErrorMessage,
  startActivationCheckout,
  type ActivationCheckoutPlan,
} from "@/app/lib/activateCareTipCheckout";
import {
  BILLING_SUBSCRIPTION_PLANS_URL,
  closeOverlayThenNavigate,
  type CloseBeforeNavigate,
} from "@/app/lib/activateCareTipNavigation";
import { cn } from "@/lib/utils";

type ActivateCareTipCtaProps = {
  className?: string;
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md";
  /** billing = link to billing page; trial = start Pro trial */
  action?: "billing" | "trial";
  closeBeforeNavigate?: CloseBeforeNavigate;
  closeAnimationMs?: number;
};

export function ActivateCareTipCta({
  className,
  variant = "primary",
  size = "sm",
  action = "billing",
  closeBeforeNavigate,
  closeAnimationMs,
}: ActivateCareTipCtaProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useAppLoadingRegistration(
    "activate-caretip",
    APP_LOADING_PRIORITY.APP_INIT,
    busy,
    t("common.loading.checkout"),
  );

  const baseClass = cn(
    "inline-flex touch-manipulation items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:opacity-60",
    size === "sm" ? "min-h-9 px-4 text-xs" : "min-h-11 px-5 text-sm",
    variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
    variant === "outline" &&
      "border border-border bg-background text-foreground hover:bg-muted/50",
    variant === "ghost" && "text-primary hover:bg-primary/10",
    className,
  );

  async function handleBillingUpgrade() {
    if (busy) return;
    setBusy(true);
    try {
      await closeOverlayThenNavigate(navigate, { closeBeforeNavigate, closeAnimationMs });
    } finally {
      setBusy(false);
    }
  }

  if (action === "billing") {
    if (closeBeforeNavigate) {
      return (
        <button
          type="button"
          className={baseClass}
          disabled={busy}
          onClick={() => void handleBillingUpgrade()}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {t("subscription.activation.upgradeCta")}
        </button>
      );
    }

    return (
      <Link to={BILLING_SUBSCRIPTION_PLANS_URL} className={baseClass}>
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        {t("subscription.activation.upgradeCta")}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={baseClass}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void startActivationCheckout("trial", t, {
          navigate,
          closeBeforeNavigate,
        })
          .catch((err) => toast.error(activationCheckoutErrorMessage(err, t)))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
      {t("subscription.activation.trialCta")}
    </button>
  );
}

export function ActivationPlanButtons({
  className,
  layout = "grid",
}: {
  className?: string;
  layout?: "grid" | "row";
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<ActivationCheckoutPlan | null>(null);

  useAppLoadingRegistration(
    "activation-plan-checkout",
    APP_LOADING_PRIORITY.APP_INIT,
    busy === "pro",
    t("common.loading.checkout"),
  );

  async function handle(plan: ActivationCheckoutPlan) {
    setBusy(plan);
    try {
      const result = await startActivationCheckout(plan, t, { navigate });
      if (result !== "stripe_navigated") {
        setBusy(null);
      }
    } catch (err) {
      toast.error(activationCheckoutErrorMessage(err, t));
      setBusy(null);
    }
  }

  return (
    <div
      className={cn(
        layout === "grid" ? "grid gap-3 sm:grid-cols-2" : "flex flex-wrap gap-3",
        className,
      )}
    >
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void handle("trial")}
        className="flex min-h-[44px] flex-col items-start gap-1 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3 text-left transition-colors hover:bg-primary/10 disabled:opacity-60"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {busy === "trial" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          )}
          {t("subscription.activation.trialCta")}
        </span>
        <span className="text-xs text-muted-foreground">{t("subscription.activation.trialHint")}</span>
      </button>

      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void handle("pro")}
        className="flex min-h-[44px] flex-col items-start gap-1 rounded-xl border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-muted/40 disabled:opacity-60"
      >
        <span className="text-sm font-semibold text-foreground">
          {busy === "pro" ? <Loader2 className="inline h-4 w-4 animate-spin" aria-hidden /> : null}
          {t("subscription.activation.proCta")}
        </span>
        <span className="text-xs text-muted-foreground">{t("subscription.activation.proHint")}</span>
      </button>
    </div>
  );
}
