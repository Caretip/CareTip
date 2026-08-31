import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { fetchPhysicalQrOrders, type PhysicalQrCustomerOrder } from "@/app/lib/api";
import { PhysicalQrOrderCard } from "@/app/components/business/physical-branding/PhysicalQrOrderCard";
import { QrStudioOrderListSkeleton } from "@/app/components/business/qr-studio/QrStudioLoadingSkeletons";
import { QR_STUDIO_BASE } from "@/app/components/business/businessDashboardNav";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { Button } from "@/components/ui/button";

export function QrStudioOrdersPage() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<PhysicalQrCustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await fetchPhysicalQrOrders();
      setOrders(data.orders ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("business.qrStudio.physical.loadError"));
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  return (
    <div className="qr-studio-orders space-y-6 max-lg:space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t("business.qrStudio.orders.subtitle")}</p>
        <Button type="button" variant="outline" className={businessUi.btnSecondary} asChild>
          <Link to={`${QR_STUDIO_BASE}/print`}>{t("business.qrStudio.overview.startOrder")}</Link>
        </Button>
      </div>

      {loading ? (
        <QrStudioOrderListSkeleton />
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : orders.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t("business.qrStudio.orders.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("business.qrStudio.orders.emptyDesc")}</p>
        </div>
      ) : (
        <div className="divide-y divide-border/80 border-y border-border/80">
          {orders.map((order) => (
            <PhysicalQrOrderCard
              key={order.id}
              order={order}
              paying={payingOrderId === order.id}
              onPay={(id) => {
                setPayingOrderId(id);
                void import("@/app/lib/api").then(({ checkoutPhysicalQrOrder }) =>
                  checkoutPhysicalQrOrder(id).then((session) => {
                    window.location.href = session.url;
                  }).finally(() => setPayingOrderId(null)),
                );
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
