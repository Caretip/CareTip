import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { PhysicalQrCustomerOrder } from "@/app/lib/api";
import {
  formatBerlinDateTime,
  formatPhysicalQrMoney,
  physicalQrContextLabel,
  physicalQrCustomerStatus,
  physicalQrOrderNumber,
  physicalQrTemplateDisplayName,
} from "@/app/lib/physicalQrOrderUi";
import { Button } from "@/components/ui/button";
import { PhysicalQrStatusBadge } from "./PhysicalQrStatusBadge";

export function PhysicalQrOrderCard({
  order,
  confirming,
  onPay,
  paying,
}: {
  order: PhysicalQrCustomerOrder;
  confirming?: boolean;
  onPay?: (orderId: string) => void;
  paying?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const failed = order.paymentStatus === "FAILED" || order.fulfillmentStatus === "PAYMENT_FAILED";
  const canPay =
    order.canPay ??
    ((order.paymentStatus === "PENDING" && order.fulfillmentStatus === "PENDING_PAYMENT") ||
      (order.paymentStatus === "FAILED" && order.fulfillmentStatus === "PAYMENT_FAILED"));
  const showPay = Boolean(canPay) && !confirming;
  const status = physicalQrCustomerStatus(order, t, confirming);
  const productName = physicalQrTemplateDisplayName(t, {
    templateId: order.templateId,
    productName: order.productName,
  });
  const itemSummary =
    order.itemCount > 1
      ? t("business.qrStudio.physical.orders.itemCount", {
          count: order.itemCount,
          defaultValue: "{{count}} QR items",
        })
      : physicalQrContextLabel(order.qrContextType, t);

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-medium leading-tight">
            {order.itemCount > 1 ? t("business.qrStudio.physical.orders.multiItemTitle", { defaultValue: "Print order" }) : productName}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            #{physicalQrOrderNumber(order.id)}
            {" · "}
            {itemSummary}
            {" · "}
            {t("business.qrStudio.physical.orders.qtyShort", { count: order.quantity })}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatBerlinDateTime(order.placedAt, i18n.language)}
          </p>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums">
          {formatPhysicalQrMoney(order.totalAmount, order.currency, i18n.language)}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <PhysicalQrStatusBadge tone={status.tone} label={status.title} />
          {status.detail ? <p className="text-sm text-muted-foreground">{status.detail}</p> : null}
        </div>
        <div className="flex items-center gap-3">
          {showPay ? (
            <Button type="button" size="sm" disabled={paying} onClick={() => onPay?.(order.id)}>
              {failed
                ? t("business.qrStudio.physical.orders.tryPaymentAgain")
                : t("business.qrStudio.physical.payNow")}
            </Button>
          ) : null}
          <Link
            to={`/dashboard/qr-studio/orders/${order.id}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            {t("business.qrStudio.physical.orders.viewOrder")}
          </Link>
        </div>
      </div>
    </div>
  );
}
