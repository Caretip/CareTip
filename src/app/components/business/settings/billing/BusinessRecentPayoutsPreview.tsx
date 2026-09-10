import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { listMyConnectPayouts, type ConnectPayout } from "../../../../lib/api";
import { formatConnectPayoutAmount, formatConnectPayoutDate } from "../../../../lib/connectPayoutDisplay";
import { ConnectPayoutStatusBadge } from "../../../connect/ConnectPayoutBadges";
import { logClientError } from "../../../../lib/clientLog";
import { cn } from "@/lib/utils";

export function BusinessRecentPayoutsPreview() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<ConnectPayout[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listMyConnectPayouts({ take: 5, skip: 0 })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err) => {
        logClientError("BusinessRecentPayoutsPreview", err);
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const locale = i18n.language;

  return (
    <section className="space-y-3" aria-labelledby="business-payout-activity-heading">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="business-payout-activity-heading" className="text-base font-semibold tracking-tight">
            {t("business.billing.payouts.activityTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("business.billing.payouts.activityHint")}</p>
        </div>
        <Link
          to="/dashboard/stripe/payouts"
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          {t("business.billing.connect.viewPayouts")}
        </Link>
      </div>
      {items == null ? (
        <p className="text-sm text-muted-foreground">{t("business.billing.payouts.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("business.billing.payouts.emptyBody")}</p>
      ) : (
        <ul className="divide-y divide-border/80">
          {items.map((payout) => (
            <li key={payout.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium tabular-nums">
                  {formatConnectPayoutAmount(payout.amountCents, payout.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatConnectPayoutDate(payout.stripeCreatedAt, locale)}
                  {payout.method === "instant" ? (
                    <span className="ml-2">{t("business.billing.payouts.methodInstant")}</span>
                  ) : (
                    <span className="ml-2">{t("business.billing.payouts.methodStandard")}</span>
                  )}
                </p>
              </div>
              <ConnectPayoutStatusBadge status={payout.status} className={cn("shrink-0")} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
