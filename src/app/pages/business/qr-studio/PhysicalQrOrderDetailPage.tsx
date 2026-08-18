import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  checkoutPhysicalQrOrder,
  fetchPhysicalQrOrder,
  type PhysicalQrCustomerOrder,
} from "@/app/lib/api";
import { performExternalStripeRedirect } from "@/app/lib/externalStripeRedirect";
import {
  formatBerlinDateTime,
  formatPhysicalQrMoney,
  physicalQrAddressLine,
  physicalQrContextLabel,
  physicalQrCustomerStatus,
  physicalQrCutoffLabel,
  physicalQrEstimatedFulfillmentLabel,
  physicalQrOrderNumber,
} from "@/app/lib/physicalQrOrderUi";
import { PhysicalQrOrderTimeline } from "../../../components/business/physical-branding/PhysicalQrOrderTimeline";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PhysicalQrOrderDetailPage() {
  useRequireAuth();
  const { t, i18n } = useTranslation();
  const { orderId = "" } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const checkoutFlag = searchParams.get("checkout");
  const [order, setOrder] = useState<PhysicalQrCustomerOrder | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(checkoutFlag === "success");

  const reload = useCallback(async () => {
    const next = await fetchPhysicalQrOrder(orderId);
    setOrder(next);
    return next;
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    void reload()
      .then((next) => {
        if (cancelled) return;
        if (next.paymentStatus === "PAID" || next.paymentStatus === "FAILED") {
          setConfirming(false);
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t("business.qrStudio.physical.loadError"));
      });
    return () => {
      cancelled = true;
    };
  }, [reload, t]);

  useEffect(() => {
    if (checkoutFlag !== "success" || !orderId) return;
    setConfirming(true);
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      try {
        const next = await fetchPhysicalQrOrder(orderId);
        if (cancelled) return;
        setOrder(next);
        if (next.paymentStatus === "PAID" || next.paymentStatus === "FAILED" || attempts >= 15) {
          setConfirming(false);
          return;
        }
      } catch {
        /* keep polling */
      }
      window.setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [checkoutFlag, orderId]);

  async function pay() {
    setPaying(true);
    try {
      const session = await checkoutPhysicalQrOrder(orderId);
      const redirected = performExternalStripeRedirect(session.url, "checkout");
      if (!redirected.ok) throw new Error(t("business.qrStudio.physical.orderError"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("business.qrStudio.physical.orderError"));
      setPaying(false);
    }
  }

  if (loadError) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }
  if (!order) {
    return <p className="text-sm text-muted-foreground">{t("business.qrStudio.physical.orders.loading")}</p>;
  }

  const address = physicalQrAddressLine(order.addressSnapshot);
  const paid = order.paymentStatus === "PAID";
  const failed = order.paymentStatus === "FAILED" || order.fulfillmentStatus === "PAYMENT_FAILED";
  const showPay = Boolean(order.canPay) && !confirming;
  const status = physicalQrCustomerStatus(order, t, confirming);

  return (
    <div className="space-y-6">
      <Link to="/dashboard/qr-studio/branding" className="text-sm font-medium text-primary hover:underline">
        {t("business.qrStudio.physical.orders.back")}
      </Link>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {order.productName || t("business.qrStudio.physical.templateName")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("business.qrStudio.physical.orders.orderNumber", { id: physicalQrOrderNumber(order.id) })}
        </p>
      </div>

      {confirming ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("business.qrStudio.physical.orders.confirmingTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t("business.qrStudio.physical.orders.confirmingBody")}
          </CardContent>
        </Card>
      ) : paid && checkoutFlag === "success" ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("business.qrStudio.physical.orders.paymentReceivedCheck")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t("business.qrStudio.physical.orders.thanksProcessing")}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">{t("business.qrStudio.physical.orders.placed")}</p>
            <p className="font-medium">{formatBerlinDateTime(order.placedAt, i18n.language)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("business.qrStudio.physical.orders.payment")}</p>
            <p className="font-medium">
              {formatPhysicalQrMoney(order.totalAmount, order.currency, i18n.language)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("business.qrStudio.physical.qrType")}</p>
            <p className="font-medium">{physicalQrContextLabel(order.qrContextType, t)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("business.qrStudio.physical.printedAddress")}</p>
            <p className="font-medium">
              {order.supportsAddress
                ? address || t("business.qrStudio.physical.withAddress")
                : t("business.qrStudio.physical.withoutAddress")}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("business.qrStudio.physical.quantity")}</p>
            <p className="font-medium">{order.quantity}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("business.qrStudio.physical.orders.status")}</p>
            <p className="font-medium">{status.title}</p>
            {status.detail ? <p className="text-sm text-muted-foreground">{status.detail}</p> : null}
          </div>
          <div className="sm:col-span-2">
            <p className="text-muted-foreground">{t("business.qrStudio.physical.orders.cutoff")}</p>
            <p className="font-medium">{physicalQrCutoffLabel(order.processingClass, t)}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-muted-foreground">{t("business.qrStudio.physical.orders.estimatedFulfillment")}</p>
            <p className="font-medium">{physicalQrEstimatedFulfillmentLabel(order.processingClass, t)}</p>
          </div>
          <div className="sm:col-span-2 text-muted-foreground">
            {t("business.qrStudio.physical.deliveryAfterShip")}
          </div>
          {order.shippedAt ? (
            <div className="sm:col-span-2 space-y-1">
              <p>
                {t("business.qrStudio.physical.shippedAt")}: {formatBerlinDateTime(order.shippedAt, i18n.language)}
              </p>
              {order.carrier ? (
                <p>
                  {t("business.qrStudio.physical.carrier")}: {order.carrier}
                </p>
              ) : null}
              {order.trackingNumber ? (
                <p>
                  {t("business.qrStudio.physical.tracking")}:{" "}
                  {order.trackingUrl ? (
                    <a className="underline" href={order.trackingUrl} target="_blank" rel="noreferrer">
                      {order.trackingNumber}
                    </a>
                  ) : (
                    order.trackingNumber
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {showPay ? (
        <Button type="button" disabled={paying} onClick={() => void pay()}>
          {failed ? t("business.qrStudio.physical.orders.tryPaymentAgain") : t("business.qrStudio.physical.payNow")}
        </Button>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("business.qrStudio.physical.orders.progress")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PhysicalQrOrderTimeline order={order} />
        </CardContent>
      </Card>
    </div>
  );
}
