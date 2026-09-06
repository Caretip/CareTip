import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { fetchPlatformPhysicalQrOrders, type PhysicalQrAdminOrder } from "../../lib/api";
import {
  formatBerlinDateCompact,
  formatPhysicalQrMoney,
  physicalQrContextLabel,
  physicalQrFulfillmentLabel,
  physicalQrOrderNumber,
  physicalQrPaymentLabel,
} from "../../lib/physicalQrOrderUi";
import { PlatformPage, PlatformPageHeader } from "../../components/platform/PlatformPageChrome";
import { platformUi } from "../../components/platform/platformDashboardUi";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  const [error, setError] = useState<string | null>(null);

  async function reload(nextFilter = filter, nextQ = q) {
    const data = await fetchPlatformPhysicalQrOrders({
      filter: nextFilter === "all" ? undefined : nextFilter,
      q: nextQ.trim() || undefined,
    });
    setOrders(data.orders);
    setError(null);
  }

  useEffect(() => {
    void reload()
      .catch((err) => {
        setError(err instanceof Error ? err.message : t("admin.physicalQr.loadError"));
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  return (
    <PlatformPage className="platform-physical-qr">
      <PlatformPageHeader
        icon={Package}
        title={t("admin.physicalQr.title")}
        subtitle={t("admin.physicalQr.subtitle")}
      />
      <div className="mb-4 flex max-w-full flex-wrap gap-2">
        {FILTERS.map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            className="h-auto max-w-full whitespace-normal"
            variant={filter === id ? "default" : "outline"}
            onClick={() => {
              setFilter(id);
              void reload(id, q).catch((err) =>
                toast.error(err instanceof Error ? err.message : t("admin.physicalQr.loadError")),
              );
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
              void reload(filter, q).catch((err) =>
                toast.error(err instanceof Error ? err.message : t("admin.physicalQr.loadError")),
              );
            }
          }}
        />
      </div>

      {loading ? (
        <div className={`${platformUi.dataPanel} mt-4`} role="status" aria-busy="true">
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
      ) : error ? (
        <p className="mt-4 text-sm text-destructive">{error}</p>
      ) : orders.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("admin.physicalQr.empty")}</p>
      ) : (
        <>
          <div className="mt-4 divide-y divide-border/80 border-y border-border/80 lg:hidden">
            {orders.map((order) => (
              <AdminOrderListRow key={order.id} order={order} compact />
            ))}
          </div>
          <div className={cn(platformUi.tableWrap, "mt-4 border-y border-border/80")}>
            <table className="pq-order-table">
              <thead>
                <tr>
                  <th>{t("admin.physicalQr.colOrder")}</th>
                  <th>{t("admin.physicalQr.business")}</th>
                  <th>{t("admin.physicalQr.colItems")}</th>
                  <th>{t("admin.physicalQr.colPayment")}</th>
                  <th>{t("admin.physicalQr.colFulfillment")}</th>
                  <th>{t("admin.physicalQr.colPlaced")}</th>
                  <th className="text-right">{t("admin.physicalQr.colAction")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <AdminOrderListRow key={order.id} order={order} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PlatformPage>
  );
}

function AdminOrderListRow({
  order,
  compact,
}: {
  order: PhysicalQrAdminOrder;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const href = `/platform-admin/branding-orders/${order.id}`;
  const items =
    order.itemCount > 1
      ? t("admin.physicalQr.itemCount", { count: order.itemCount, defaultValue: "{{count}} QR items" })
      : physicalQrContextLabel(order.qrContextType, t);

  if (compact) {
    return (
      <Link to={href} className="block py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">#{physicalQrOrderNumber(order.id)}</p>
            <p className="mt-0.5 break-words text-sm text-muted-foreground">
              {order.businessName} · {items} · ×{order.quantity}
            </p>
          </div>
          <p className="shrink-0 text-sm font-semibold tabular-nums">
            {formatPhysicalQrMoney(order.totalAmount, order.currency, i18n.language)}
          </p>
        </div>
        <p className="mt-2 text-sm">
          {physicalQrPaymentLabel(order.paymentStatus, t, { totalAmount: order.totalAmount })}
          {" · "}
          {physicalQrFulfillmentLabel(order.fulfillmentStatus, t, { totalAmount: order.totalAmount })}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatBerlinDateCompact(order.placedAt, i18n.language)}
        </p>
      </Link>
    );
  }

  return (
    <tr>
      <td>
        <Link to={href} className="font-medium hover:underline">
          #{physicalQrOrderNumber(order.id)}
        </Link>
      </td>
      <td className="min-w-0 break-words">{order.businessName}</td>
      <td className="text-muted-foreground">
        {items} · ×{order.quantity}
      </td>
      <td>{physicalQrPaymentLabel(order.paymentStatus, t, { totalAmount: order.totalAmount })}</td>
      <td className="font-medium">
        {physicalQrFulfillmentLabel(order.fulfillmentStatus, t, { totalAmount: order.totalAmount })}
      </td>
      <td className="whitespace-nowrap text-muted-foreground">
        {formatBerlinDateCompact(order.placedAt, i18n.language)}
      </td>
      <td className="text-right">
        <Link to={href} className="text-sm font-medium text-primary hover:underline">
          {t("admin.physicalQr.openOrder")}
        </Link>
      </td>
    </tr>
  );
}
