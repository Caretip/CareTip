import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { PhysicalQrCustomerOrder } from "@/app/lib/api";
import {
  formatBerlinDateCompact,
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
  layout = "list",
}: {
  order: PhysicalQrCustomerOrder;
  confirming?: boolean;
  onPay?: (orderId: string) => void;
  paying?: boolean;
  layout?: "list" | "table";
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
  const href = `/dashboard/qr-studio/orders/${order.id}`;

  if (layout === "table") {
    return (
      <tr>
        <td>
          <Link to={href} className="font-medium text-foreground hover:underline">
            #{physicalQrOrderNumber(order.id)}
          </Link>
        </td>
        <td className="min-w-0">
          <p className="truncate font-medium">{productName}</p>
          <p className="text-xs text-muted-foreground">
            {itemSummary} · {t("business.qrStudio.physical.orders.qtyShort", { count: order.quantity })}
          </p>
        </td>
        <td className="whitespace-nowrap text-muted-foreground">
          {formatBerlinDateCompact(order.placedAt, i18n.language)}
        </td>
        <td className="whitespace-nowrap font-semibold tabular-nums">
          {formatPhysicalQrMoney(order.totalAmount, order.currency, i18n.language)}
        </td>
        <td>
          <PhysicalQrStatusBadge tone={status.tone} label={status.title} />
        </td>
        <td className="text-right">
          {showPay ? (
            <Button type="button" size="sm" disabled={paying} onClick={() => onPay?.(order.id)}>
              {failed
                ? t("business.qrStudio.physical.orders.tryPaymentAgain")
                : t("business.qrStudio.physical.payNow")}
            </Button>
          ) : (
            <Link to={href} className="text-sm font-medium text-primary hover:underline">
              {t("business.qrStudio.physical.orders.viewOrder")}
            </Link>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={href} className="break-words font-medium leading-tight hover:underline">
              #{physicalQrOrderNumber(order.id)}
            </Link>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {productName} · {itemSummary} · {t("business.qrStudio.physical.orders.qtyShort", { count: order.quantity })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatBerlinDateCompact(order.placedAt, i18n.language)}
            </p>
          </div>
          <p className="shrink-0 text-sm font-semibold tabular-nums">
            {formatPhysicalQrMoney(order.totalAmount, order.currency, i18n.language)}
          </p>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <PhysicalQrStatusBadge tone={status.tone} label={status.title} />
          <div className="flex items-center gap-3">
            {showPay ? (
              <Button type="button" size="sm" disabled={paying} onClick={() => onPay?.(order.id)}>
                {failed
                  ? t("business.qrStudio.physical.orders.tryPaymentAgain")
                  : t("business.qrStudio.physical.payNow")}
              </Button>
            ) : null}
            <Link to={href} className="text-sm font-medium text-primary hover:underline">
              {t("business.qrStudio.physical.orders.viewOrder")}
            </Link>
        </div>
      </div>
    </div>
  );
}
