import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  checkoutPhysicalQrOrder,
  fetchPhysicalQrOrder,
  type PhysicalQrCustomerOrder,
} from "@/app/lib/api";
import {
  readPhysicalQrOrderSnapshot,
  writePhysicalQrOrderSnapshot,
} from "@/app/lib/physicalQrOrdersSessionCache";
import { performExternalStripeRedirect } from "@/app/lib/externalStripeRedirect";
import {
  formatBerlinDateTime,
  formatPhysicalQrMoney,
  isPhysicalQrIncludedOrder,
  physicalQrAddressLine,
  physicalQrContactFromUnknown,
  physicalQrContextLabel,
  physicalQrCustomerStatus,
  physicalQrCutoffLabel,
  physicalQrEstimatedFulfillmentLabel,
  physicalQrOrderNumber,
  physicalQrShippingLine,
  physicalQrTemplateDisplayName,
  groupPhysicalQrItemsByLocation,
} from "@/app/lib/physicalQrOrderUi";
import { PhysicalQrOrderTimeline } from "../../../components/business/physical-branding/PhysicalQrOrderTimeline";
import { PhysicalQrStatusBadge } from "../../../components/business/physical-branding/PhysicalQrStatusBadge";
import { QrStudioOrderDetailSkeleton } from "../../../components/business/qr-studio/QrStudioLoadingSkeletons";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PhysicalQrOrderDetailPage() {
  const { user } = useRequireAuth();
  const { t, i18n } = useTranslation();
  const { orderId = "" } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const checkoutFlag = searchParams.get("checkout");
  const businessId = user?.businessId?.trim() || "";
  const [order, setOrder] = useState<PhysicalQrCustomerOrder | null>(() =>
    readPhysicalQrOrderSnapshot(businessId, orderId),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(checkoutFlag === "success");

  useEffect(() => {
    setLoadError(null);
    const snap = readPhysicalQrOrderSnapshot(businessId, orderId);
    if (snap) {
      setOrder(snap);
      return;
    }
    setOrder((prev) => (prev?.id === orderId ? prev : null));
  }, [businessId, orderId]);

  const reload = useCallback(async () => {
    const next = await fetchPhysicalQrOrder(orderId, { revalidate: true });
    setOrder(next);
    if (businessId) writePhysicalQrOrderSnapshot(businessId, next);
    return next;
  }, [businessId, orderId]);

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
        if (!cancelled && !readPhysicalQrOrderSnapshot(businessId, orderId)) {
          setLoadError(err instanceof Error ? err.message : t("business.qrStudio.physical.loadError"));
        }
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
        const next = await fetchPhysicalQrOrder(orderId, { revalidate: true });
        if (cancelled) return;
        setOrder(next);
        if (businessId) writePhysicalQrOrderSnapshot(businessId, next);
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
  }, [checkoutFlag, orderId, businessId]);

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
    return <QrStudioOrderDetailSkeleton />;
  }

  const address = physicalQrAddressLine(order.addressSnapshot);
  const shipTo = physicalQrShippingLine(order.shippingSnapshot);
  const contact = physicalQrContactFromUnknown(order.contactSnapshot);
  const paid = order.paymentStatus === "PAID";
  const failed = order.paymentStatus === "FAILED" || order.fulfillmentStatus === "PAYMENT_FAILED";
  const showPay = Boolean(order.canPay) && !confirming;
  const status = physicalQrCustomerStatus(order, t, confirming);
  const included = isPhysicalQrIncludedOrder(order);

  return (
    <div className="physical-qr-order-detail space-y-6">
      <Link to="/dashboard/qr-studio/print" className="text-sm font-medium text-primary hover:underline">
        {t("business.qrStudio.physical.orders.back")}
      </Link>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {physicalQrTemplateDisplayName(t, {
            templateId: order.templateId,
            productName: order.productName,
          })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("business.qrStudio.physical.orders.orderNumber", { id: physicalQrOrderNumber(order.id) })}
        </p>
      </div>

      {confirming ? (
        <Card className="physical-qr-order-detail__section dashboard-mobile-keep-card">
          <CardHeader>
            <CardTitle>
              {included
                ? t("business.qrStudio.physical.orders.confirmingIncludedTitle")
                : t("business.qrStudio.physical.orders.confirmingTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {included
              ? t("business.qrStudio.physical.orders.confirmingIncludedBody")
              : t("business.qrStudio.physical.orders.confirmingBody")}
          </CardContent>
        </Card>
      ) : paid && checkoutFlag === "success" ? (
        <Card className="physical-qr-order-detail__section dashboard-mobile-keep-card">
          <CardHeader>
            <CardTitle>
              {included
                ? t("business.qrStudio.physical.orders.orderReceivedCheck")
                : t("business.qrStudio.physical.orders.paymentReceivedCheck")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {included
              ? t("business.qrStudio.physical.orders.orderReceivedProcessing")
              : t("business.qrStudio.physical.orders.thanksProcessing")}
          </CardContent>
        </Card>
      ) : null}

      <Card className="physical-qr-order-detail__section">
        <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-2 max-lg:pt-3 max-lg:gap-2.5">
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
            {order.items.length > 1 ? (
              <div className="mt-1 space-y-3 text-sm font-medium">
                {groupPhysicalQrItemsByLocation(
                  order.items,
                  t("business.qrStudio.print.locationBusiness"),
                ).map((group) => (
                  <div key={group.locationName}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.locationName}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {group.items.map((item) => (
                        <li key={item.id} className="break-words">
                          {item.label} · {physicalQrContextLabel(item.qrContextType, t)} · ×{item.quantity}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-medium">{physicalQrContextLabel(order.qrContextType, t)}</p>
            )}
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
            <p className="text-muted-foreground">{t("business.qrStudio.physical.shipTo")}</p>
            <p className="font-medium">{shipTo || t("business.qrStudio.physical.deliveryNotCollected")}</p>
          </div>
          {contact ? (
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">{t("business.qrStudio.physical.contact")}</p>
              <p className="font-medium">
                {[contact.name, contact.email, contact.phone].filter(Boolean).join(" · ")}
              </p>
            </div>
          ) : null}
          <div>
            <p className="text-muted-foreground">{t("business.qrStudio.physical.quantity")}</p>
            <p className="font-medium">{order.quantity}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("business.qrStudio.physical.orders.status")}</p>
            <div className="mt-1 space-y-1">
              <PhysicalQrStatusBadge tone={status.tone} label={status.title} />
              {status.detail ? <p className="text-sm text-muted-foreground">{status.detail}</p> : null}
            </div>
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

      <Card className="physical-qr-order-detail__section">
        <CardHeader className="max-lg:px-0">
          <CardTitle>{t("business.qrStudio.physical.orders.progress")}</CardTitle>
        </CardHeader>
        <CardContent className="max-lg:px-0">
          <PhysicalQrOrderTimeline order={order} />
        </CardContent>
      </Card>
    </div>
  );
}
