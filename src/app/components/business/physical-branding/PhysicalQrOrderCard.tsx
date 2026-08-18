import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { PhysicalQrCustomerOrder } from "@/app/lib/api";
import {
  formatBerlinDateTime,
  formatPhysicalQrMoney,
  physicalQrContextLabel,
  physicalQrCustomerStatus,
  physicalQrOrderNumber,
} from "@/app/lib/physicalQrOrderUi";
import { Button } from "@/components/ui/button";

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
  const productName = order.productName || t("business.qrStudio.physical.templateName");

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-medium leading-tight">{productName}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            #{physicalQrOrderNumber(order.id)}
            {" · "}
            {physicalQrContextLabel(order.qrContextType, t)}
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
        <div className="min-w-0">
          <p className="text-sm font-medium">{status.title}</p>
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
            to={`/dashboard/qr-studio/branding/orders/${order.id}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            {t("business.qrStudio.physical.orders.viewOrder")}
          </Link>
        </div>
      </div>
    </div>
  );
}
