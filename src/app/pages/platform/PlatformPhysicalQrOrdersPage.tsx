import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { fetchPlatformPhysicalQrOrders, type PhysicalQrAdminOrder } from "../../lib/api";
import {
  formatBerlinDateTime,
  formatPhysicalQrMoney,
  physicalQrContextLabel,
  physicalQrFulfillmentLabel,
  physicalQrOrderNumber,
  physicalQrPaymentLabel,
  physicalQrShippingFromUnknown,
} from "../../lib/physicalQrOrderUi";
import { PlatformPage, PlatformPageHeader } from "../../components/platform/PlatformPageChrome";
import { platformUi } from "../../components/platform/platformDashboardUi";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const FILTERS = [
  "all",
  "pending_payment",
  "paid",
  "processing",
  "printing",
  "shipped",
  "delivered",
  "cancelled",
  "payment_failed",
] as const;

export function PlatformPhysicalQrOrdersPage() {
  const { t, i18n } = useTranslation();
  const [orders, setOrders] = useState<PhysicalQrAdminOrder[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  async function reload(nextFilter = filter, nextQ = q) {
    const data = await fetchPlatformPhysicalQrOrders({
      filter: nextFilter === "all" ? undefined : nextFilter,
      q: nextQ.trim() || undefined,
    });
    setOrders(data.orders);
  }

  useEffect(() => {
    void reload()
      .catch(() => toast.error(t("admin.physicalQr.loadError")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Package}
        title={t("admin.physicalQr.title")}
        subtitle={t("admin.physicalQr.subtitle")}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={filter === id ? "default" : "outline"}
            onClick={() => {
              setFilter(id);
              void reload(id, q).catch(() => toast.error(t("admin.physicalQr.loadError")));
            }}
          >
            {t(`admin.physicalQr.filters.${id}`)}
          </Button>
        ))}
      </div>
      <div className={platformUi.searchWrap}>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("admin.physicalQr.searchPlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void reload(filter, q).catch(() => toast.error(t("admin.physicalQr.loadError")));
            }
          }}
        />
      </div>
      <div className="mt-4 space-y-3">
        {loading ? (
          <div className={platformUi.contentCard} role="status" aria-busy="true">
            <div className="space-y-3">
              {[0, 1, 2].map((row) => (
                <div key={row} className="space-y-2 border-b border-border/50 pb-3 last:border-0 last:pb-0">
                  <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-64 max-w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-48 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          </div>
        ) : orders.length === 0 ? (
          <div className={platformUi.contentCard}>
            <p className="text-sm text-muted-foreground">{t("admin.physicalQr.empty")}</p>
          </div>
        ) : (
          orders.map((order) => {
            const shipping = physicalQrShippingFromUnknown(order.shippingSnapshot);
            return (
            <Link
              key={order.id}
              to={`/platform-admin/branding-orders/${order.id}`}
              className={`${platformUi.contentCard} block hover:border-primary/40`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {t("business.qrStudio.physical.orders.orderNumber", {
                      id: physicalQrOrderNumber(order.id),
                    })}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {order.businessName}
                    {" · "}
                    {order.itemCount > 1
                      ? t("admin.physicalQr.itemCount", {
                          count: order.itemCount,
                          defaultValue: "{{count}} QR items",
                        })
                      : physicalQrContextLabel(order.qrContextType, t)}
                    {" · ×"}
                    {order.quantity}
                    {shipping ? ` · ${shipping.city}, ${shipping.country}` : ""}
                  </p>
                </div>
                <p className="text-sm font-semibold">
                  {formatPhysicalQrMoney(order.totalAmount, order.currency, i18n.language)}
                </p>
              </div>
              <p className="mt-2 text-sm">
                {physicalQrPaymentLabel(order.paymentStatus, t, { totalAmount: order.totalAmount })} ·{" "}
                {physicalQrFulfillmentLabel(order.fulfillmentStatus, t, { totalAmount: order.totalAmount })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatBerlinDateTime(order.placedAt, i18n.language)}
                {order.updatedAt ? ` · ${formatBerlinDateTime(order.updatedAt, i18n.language)}` : ""}
              </p>
            </Link>
            );
          })
        )}
      </div>
    </PlatformPage>
  );
}
