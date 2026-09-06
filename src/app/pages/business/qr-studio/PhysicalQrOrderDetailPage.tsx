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
  physicalQrPaymentLabel,
  physicalQrShippingFromUnknown,
  physicalQrTemplateDisplayName,
  groupPhysicalQrItemsByLocation,
} from "@/app/lib/physicalQrOrderUi";
import { PhysicalQrOrderTimeline } from "../../../components/business/physical-branding/PhysicalQrOrderTimeline";
import { PhysicalQrStatusBadge } from "../../../components/business/physical-branding/PhysicalQrStatusBadge";
import { QrStudioOrderDetailSkeleton } from "../../../components/business/qr-studio/QrStudioLoadingSkeletons";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { Button } from "@/components/ui/button";
import { QR_STUDIO_BASE } from "../../../components/business/businessDashboardNav";
import { businessUi } from "../../../components/business/businessDashboardUi";
import { cn } from "@/lib/utils";

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
    return <QrStudioOrderDetailSkeleton className="physical-qr-order-detail" />;
  }

  const address = physicalQrAddressLine(order.addressSnapshot);
  const shipping = physicalQrShippingFromUnknown(order.shippingSnapshot);
  const contact = physicalQrContactFromUnknown(order.contactSnapshot);
  const failed = order.paymentStatus === "FAILED" || order.fulfillmentStatus === "PAYMENT_FAILED";
  const showPay = Boolean(order.canPay) && !confirming;
  const status = physicalQrCustomerStatus(order, t, confirming);
  const included = isPhysicalQrIncludedOrder(order);
  const productName = physicalQrTemplateDisplayName(t, {
    templateId: order.templateId,
    productName: order.productName,
  });
  const groups = groupPhysicalQrItemsByLocation(
    order.items,
    t("business.qrStudio.print.locationBusiness"),
  );
  const showConfirmingNotice = confirming;
  const progressDetail =
    status.detail && status.tone !== "paid" ? status.detail : null;

  return (
    <article className="physical-qr-order-detail">
      <header className="pq-order-header">
        <Link to={`${QR_STUDIO_BASE}/orders`} className="pq-order-header__back">
          {t("business.qrStudio.physical.orders.back")}
        </Link>
        <h1 className="pq-order-header__title">
          {t("business.qrStudio.physical.orders.orderNumber", { id: physicalQrOrderNumber(order.id) })}
        </h1>
        <p className="pq-order-header__meta">
          {t("business.qrStudio.physical.orders.placed")} {formatBerlinDateTime(order.placedAt, i18n.language)}
        </p>
        <div className="pq-order-header__status">
          <PhysicalQrStatusBadge tone={status.tone} label={status.title} />
        </div>
      </header>

      {showConfirmingNotice ? (
        <div className="pq-order-notice" role="status">
          <p className="pq-order-notice__title">
            {included
              ? t("business.qrStudio.physical.orders.confirmingIncludedTitle")
              : t("business.qrStudio.physical.orders.confirmingTitle")}
          </p>
          <p className="pq-order-notice__body">
            {included
              ? t("business.qrStudio.physical.orders.confirmingIncludedBody")
              : t("business.qrStudio.physical.orders.confirmingBody")}
          </p>
        </div>
      ) : null}

      <section className="pq-order-section pq-order-summary" aria-labelledby="pq-order-summary-heading">
        <div className="min-w-0">
          <h2 id="pq-order-summary-heading" className="pq-order-section__title">
            {t("business.qrStudio.physical.orders.sectionOrder")}
          </h2>
          <p className="pq-order-product">{productName}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.supportsAddress
              ? address || t("business.qrStudio.physical.withAddress")
              : t("business.qrStudio.physical.withoutAddress")}
          </p>
          {order.items.length > 0 ? (
            <div className="mt-4">
              {groups.map((group) => (
                <div key={group.locationName} className="pq-item-group">
                  {groups.length > 1 ? <p className="pq-item-group__name">{group.locationName}</p> : null}
                  {group.items.map((item) => (
                    <div key={item.id} className="pq-item-row">
                      <div className="min-w-0">
                        <p className="pq-item-row__name">{item.label}</p>
                        <p className="pq-item-row__meta">{physicalQrContextLabel(item.qrContextType, t)}</p>
                      </div>
                      <span className="pq-item-row__qty">×{item.quantity}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm">
              {physicalQrContextLabel(order.qrContextType, t)} · ×{order.quantity}
            </p>
          )}
        </div>
        <aside className="pq-order-aside">
          <div>
            <p className="pq-meta__label">{t("business.qrStudio.physical.orders.orderTotalLabel")}</p>
            <p className="pq-meta__value pq-meta__value--total">
              {formatPhysicalQrMoney(order.totalAmount, order.currency, i18n.language)}
            </p>
          </div>
          <div>
            <p className="pq-meta__label">{t("business.qrStudio.physical.orders.payment")}</p>
            <p className="pq-meta__value pq-meta__value--quiet">
              {physicalQrPaymentLabel(order.paymentStatus, t, { totalAmount: order.totalAmount })}
            </p>
            {order.paidAt ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatBerlinDateTime(order.paidAt, i18n.language)}
              </p>
            ) : null}
          </div>
          <div>
            <p className="pq-meta__label">{t("business.qrStudio.physical.orders.status")}</p>
            <p className="pq-meta__value pq-meta__value--quiet">{status.title}</p>
          </div>
        </aside>
      </section>

      <section className="pq-order-section" aria-labelledby="pq-order-delivery-heading">
        <h2 id="pq-order-delivery-heading" className="pq-order-section__title">
          {t("business.qrStudio.physical.orders.sectionDelivery")}
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="pq-meta__label">{t("business.qrStudio.physical.shipTo")}</p>
            {shipping ? (
              <div className="pq-meta__value pq-meta__value--quiet mt-1 space-y-0.5">
                <p>{shipping.recipientName}</p>
                {shipping.streetLine ? <p>{shipping.streetLine}</p> : null}
                {shipping.addressLine2 ? <p>{shipping.addressLine2}</p> : null}
                <p>
                  {[shipping.postalCode, shipping.city].filter(Boolean).join(" ")}
                  {shipping.country ? `, ${shipping.country}` : ""}
                </p>
              </div>
            ) : (
              <p className="pq-meta__value pq-meta__value--quiet">
                {t("business.qrStudio.physical.deliveryNotCollected")}
              </p>
            )}
          </div>
          <div className="min-w-0">
            {contact ? (
              <>
                <p className="pq-meta__label">{t("business.qrStudio.physical.contact")}</p>
                <div className="pq-meta__value pq-meta__value--quiet mt-1 space-y-0.5">
                  {contact.name ? <p>{contact.name}</p> : null}
                  {contact.email ? <p className="break-all">{contact.email}</p> : null}
                  {contact.phone ? <p>{contact.phone}</p> : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
        {order.shippedAt ? (
          <div className="mt-5 space-y-1 text-sm">
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
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">
            {physicalQrEstimatedFulfillmentLabel(order.processingClass, t)}{" "}
            {physicalQrCutoffLabel(order.processingClass, t)}. {t("business.qrStudio.physical.deliveryAfterShip")}
          </p>
        )}
      </section>

      {showPay ? (
        <div className="pq-order-section">
          <Button
            type="button"
            disabled={paying}
            onClick={() => void pay()}
            className={cn(businessUi.btnPrimary)}
          >
            {failed ? t("business.qrStudio.physical.orders.tryPaymentAgain") : t("business.qrStudio.physical.payNow")}
          </Button>
        </div>
      ) : null}

      <section className="pq-order-section" aria-labelledby="pq-order-progress-heading">
        <h2 id="pq-order-progress-heading" className="pq-order-section__title">
          {t("business.qrStudio.physical.orders.progress")}
        </h2>
        <PhysicalQrOrderTimeline order={order} currentDetail={progressDetail} />
      </section>
    </article>
  );
}
