import { Link } from "react-router";
import { useTranslation } from "react-i18next";

export function SubscriptionCanceledPage() {
  const { t } = useTranslation();

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background px-4 py-16"
      data-caretip-route-ready=""
    >
      <div className="w-full max-w-md rounded-lg border border-border/70 bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">
          {t("business.billing.checkoutCanceled")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("business.billing.subscriptionSuccess.canceledBody")}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            to="/pricing"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {t("business.billing.subscriptionSuccess.backToPricing")}
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted/50"
          >
            {t("business.billing.subscriptionSuccess.goToDashboard")}
          </Link>
        </div>
      </div>
    </div>
  );
}
