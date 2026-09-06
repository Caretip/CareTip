import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { checkoutPhysicalQrOrder, fetchPhysicalQrOrders, type PhysicalQrCustomerOrder } from "@/app/lib/api";
import { performExternalStripeRedirect } from "@/app/lib/externalStripeRedirect";
import {
  readPhysicalQrOrdersSnapshot,
  writePhysicalQrOrdersSnapshot,
} from "@/app/lib/physicalQrOrdersSessionCache";
import { PhysicalQrOrderCard } from "@/app/components/business/physical-branding/PhysicalQrOrderCard";
import { QrStudioOrderListSkeleton } from "@/app/components/business/qr-studio/QrStudioLoadingSkeletons";
import { QR_STUDIO_BASE } from "@/app/components/business/businessDashboardNav";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { Button } from "@/components/ui/button";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { cn } from "@/lib/utils";

export function QrStudioOrdersPage() {
  const { t } = useTranslation();
  const { user } = useRequireAuth();
  const businessId = user?.businessId?.trim() || "";
  const initial = readPhysicalQrOrdersSnapshot(businessId);
  const [orders, setOrders] = useState<PhysicalQrCustomerOrder[]>(() => initial?.orders ?? []);
  const [loading, setLoading] = useState(() => !initial);
  const [error, setError] = useState<string | null>(null);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await fetchPhysicalQrOrders({ revalidate: true });
      const next = data.orders ?? [];
      setOrders(next);
      setError(null);
      if (businessId) writePhysicalQrOrdersSnapshot(businessId, next);
    } catch (err) {
      if (!readPhysicalQrOrdersSnapshot(businessId)) {
        setError(err instanceof Error ? err.message : t("business.qrStudio.physical.loadError"));
      }
    }
  }, [businessId, t]);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    const snap = readPhysicalQrOrdersSnapshot(businessId);
    if (snap) {
      setOrders(snap.orders);
      setLoading(false);
      setError(null);
    }
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
  }, [businessId, reload]);

  const payOrder = useCallback(
    async (id: string) => {
      setPayingOrderId(id);
      try {
        const session = await checkoutPhysicalQrOrder(id);
        const redirected = performExternalStripeRedirect(session.url, "checkout");
        if (!redirected.ok) {
          throw new Error(t("business.qrStudio.physical.orderError"));
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("business.qrStudio.physical.orderError"));
        setPayingOrderId(null);
      }
    },
    [t],
  );

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
        <>
        <div className="divide-y divide-border/80 border-y border-border/80 lg:hidden">
          {orders.map((order) => (
            <PhysicalQrOrderCard
              key={order.id}
              order={order}
              layout="list"
              paying={payingOrderId === order.id}
              onPay={(oid) => {
                void payOrder(oid);
              }}
            />
          ))}
        </div>
        <div className={cn(businessUi.tableWrap, "border-y border-border/80")}>
          <table className="pq-order-table">
            <thead>
              <tr>
                <th>{t("business.qrStudio.physical.orders.colOrder")}</th>
                <th>{t("business.qrStudio.physical.orders.colProduct")}</th>
                <th>{t("business.qrStudio.physical.orders.colDate")}</th>
                <th>{t("business.qrStudio.physical.orders.colAmount")}</th>
                <th>{t("business.qrStudio.physical.orders.status")}</th>
                <th className="text-right">{t("business.qrStudio.physical.orders.colAction")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <PhysicalQrOrderCard
                  key={order.id}
                  order={order}
                  layout="table"
                  paying={payingOrderId === order.id}
                  onPay={(oid) => {
                    void payOrder(oid);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
