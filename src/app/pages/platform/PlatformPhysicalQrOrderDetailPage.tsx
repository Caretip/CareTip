import { useCallback, useEffect, useState, Fragment } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  deliverPlatformPhysicalQrOrder,
  downloadPlatformPhysicalQrOrderPrint,
  fetchPlatformPhysicalQrOrder,
  markPlatformPhysicalQrPrinting,
  markPlatformPhysicalQrProcessing,
  postPlatformPhysicalQrInternalNote,
  shipPlatformPhysicalQrOrder,
  type PhysicalQrAdminOrder,
  type PhysicalQrInternalNote,
} from "../../lib/api";
import {
  formatBerlinDateTime,
  formatPhysicalQrMoney,
  physicalQrAddressLine,
  physicalQrAdminNextStep,
  physicalQrContactFromUnknown,
  physicalQrContextLabel,
  physicalQrCutoffLabel,
  physicalQrEstimatedFulfillmentLabel,
  physicalQrFulfillmentLabel,
  physicalQrOrderNumber,
  physicalQrPaymentLabel,
  physicalQrShippingLine,
  groupPhysicalQrItemsByLocation,
} from "../../lib/physicalQrOrderUi";
import { PlatformPhysicalQrOrderSkeleton } from "../../components/business/qr-studio/QrStudioLoadingSkeletons";
import { PlatformPage, PlatformPageHeader } from "../../components/platform/PlatformPageChrome";
import { platformUi } from "../../components/platform/platformDashboardUi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { Package } from "lucide-react";

export function PlatformPhysicalQrOrderDetailPage() {
  const { t, i18n } = useTranslation();
  const { orderId = "" } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<PhysicalQrAdminOrder | null>(null);
  const [notes, setNotes] = useState<PhysicalQrInternalNote[]>([]);
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingItemId, setDownloadingItemId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await fetchPlatformPhysicalQrOrder(orderId);
    setOrder(data.order);
    setNotes(data.internalNotes);
    setCarrier(data.order.carrier ?? "");
    setTrackingNumber(data.order.trackingNumber ?? "");
    setTrackingUrl(data.order.trackingUrl ?? "");
    setLoadError(null);
  }, [orderId]);

  useEffect(() => {
    void reload().catch((err) => {
      setLoadError(err instanceof Error ? err.message : t("admin.physicalQr.loadError"));
    });
  }, [reload, t]);

  async function downloadPdf(itemId?: string) {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    setDownloadingItemId(itemId ?? null);
    try {
      await downloadPlatformPhysicalQrOrderPrint(orderId, "pdf", itemId);
      const pages = itemId
        ? order?.items.find((item) => item.id === itemId)?.quantity ?? 1
        : order?.quantity ?? 1;
      toast.success(
        itemId || pages <= 1
          ? t("admin.physicalQr.downloadPdfDone")
          : t("admin.physicalQr.downloadAllPdfsDone", { count: pages }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.physicalQr.downloadPdfError"));
    } finally {
      setDownloadingPdf(false);
      setDownloadingItemId(null);
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.physicalQr.actionError"));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <PlatformPage className="platform-physical-qr">
        <p className="text-sm text-destructive">{loadError}</p>
      </PlatformPage>
    );
  }

  if (!order) {
    return (
      <PlatformPage className="platform-physical-qr">
        <PlatformPhysicalQrOrderSkeleton />
      </PlatformPage>
    );
  }

  const address = physicalQrAddressLine(order.addressSnapshot);
  const shipTo = physicalQrShippingLine(order.shippingSnapshot);
  const contact = physicalQrContactFromUnknown(order.contactSnapshot);
  const groupedItems = groupPhysicalQrItemsByLocation(
    order.items,
    t("business.qrStudio.print.locationBusiness"),
  );
  const totalPages = order.quantity;
  const bulkLabel =
    order.itemCount > 1 || totalPages > 1
      ? downloadingPdf && !downloadingItemId
        ? t("admin.physicalQr.preparingPdfs", { count: totalPages })
        : t("admin.physicalQr.downloadAllPdfs", { count: totalPages })
      : t("admin.physicalQr.downloadPdf");
  const nextStep = physicalQrAdminNextStep(order.fulfillmentStatus, t);
  const paymentLabel = physicalQrPaymentLabel(order.paymentStatus, t, { totalAmount: order.totalAmount });
  const fulfillmentLabel = physicalQrFulfillmentLabel(order.fulfillmentStatus, t, {
    totalAmount: order.totalAmount,
  });

  return (
    <PlatformPage className="platform-physical-qr">
      <div className="pq-fulfillment-workspace">
        <Link to="/platform-admin/branding-orders" className={platformUi.backLink}>
          {t("admin.physicalQr.back")}
        </Link>
        <PlatformPageHeader
          icon={Package}
          title={t("business.qrStudio.physical.orders.orderNumber", { id: physicalQrOrderNumber(order.id) })}
          subtitle={order.businessName ?? ""}
        />

        <div className="pq-ops-strip">
          <div>
            <p className="pq-meta__label">{t("admin.physicalQr.colPayment")}</p>
            <p className="pq-meta__value">{paymentLabel}</p>
            {order.paidAt ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatBerlinDateTime(order.paidAt, i18n.language)}
              </p>
            ) : null}
          </div>
          <div>
            <p className="pq-meta__label">{t("admin.physicalQr.colFulfillment")}</p>
            <p className="pq-meta__value">{fulfillmentLabel}</p>
          </div>
          <div>
            <p className="pq-meta__label">{t("admin.physicalQr.nextAction")}</p>
            <p className="pq-meta__value pq-meta__value--quiet">
              {nextStep ?? t("admin.physicalQr.nextNone")}
            </p>
          </div>
        </div>

        <div className="platform-physical-qr__actions pq-admin-actions">
          {order.paymentStatus === "PAID" ? (
            <Button
              type="button"
              variant="outline"
              className="h-auto max-w-full whitespace-normal"
              disabled={downloadingPdf}
              onClick={() => void downloadPdf()}
            >
              {bulkLabel}
            </Button>
          ) : (
            <p className="break-words text-sm text-muted-foreground">{t("admin.physicalQr.printUnpaidHint")}</p>
          )}
          {order.fulfillmentStatus === "PAID" ? (
            <Button
              type="button"
              className="h-auto max-w-full whitespace-normal"
              disabled={busy}
              onClick={() => void run(() => markPlatformPhysicalQrProcessing(order.id))}
            >
              {t("admin.physicalQr.markProcessing")}
            </Button>
          ) : null}
          {order.fulfillmentStatus === "PROCESSING" ? (
            <Button
              type="button"
              className="h-auto max-w-full whitespace-normal"
              disabled={busy}
              onClick={() => void run(() => markPlatformPhysicalQrPrinting(order.id))}
            >
              {t("admin.physicalQr.markPrinting")}
            </Button>
          ) : null}
          {order.fulfillmentStatus === "SHIPPED" ? (
            <Button
              type="button"
              className="h-auto max-w-full whitespace-normal"
              disabled={busy}
              onClick={() => void run(() => deliverPlatformPhysicalQrOrder(order.id))}
            >
              {t("admin.physicalQr.markDelivered")}
            </Button>
          ) : null}
        </div>

        {order.fulfillmentStatus === "PRINTING" ? (
          <div className="pq-order-section grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>{t("admin.physicalQr.carrier")}</Label>
              <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("admin.physicalQr.trackingNumber")}</Label>
              <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("admin.physicalQr.trackingUrl")}</Label>
              <Input value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} />
            </div>
            <Button
              type="button"
              className="h-auto max-w-full whitespace-normal sm:col-span-3"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  shipPlatformPhysicalQrOrder(order.id, {
                    carrier,
                    trackingNumber,
                    trackingUrl: trackingUrl || undefined,
                  }),
                )
              }
            >
              {t("admin.physicalQr.markShipped")}
            </Button>
          </div>
        ) : null}

        {order.fulfillmentStatus === "SHIPPED" && order.shippedAt ? (
          <p className="break-words py-3 text-sm text-muted-foreground">
            {t("admin.physicalQr.shippedAt")}: {formatBerlinDateTime(order.shippedAt, i18n.language)}
            {order.carrier ? ` · ${order.carrier}` : ""}
            {order.trackingNumber ? ` · ${order.trackingNumber}` : ""}
          </p>
        ) : null}

        <section className="pq-order-section" aria-labelledby="pq-admin-items-heading">
          <h2 id="pq-admin-items-heading" className="pq-order-section__title">
            {t("admin.physicalQr.orderItems")}
          </h2>
          {order.items.length > 0 ? (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                {t("admin.physicalQr.orderItemsSummary", {
                  lines: order.itemCount,
                  copies: order.quantity,
                })}
              </p>
              <div className="lg:hidden space-y-3">
                {groupedItems.map((group) => (
                  <div key={group.locationName} className="space-y-2">
                    {groupedItems.length > 1 ? (
                      <p className="break-words text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.locationName}
                      </p>
                    ) : null}
                    {group.items.map((item) => (
                      <div key={item.id} className="min-w-0 border-b border-border/70 py-2 last:border-0">
                        <p className="break-words font-medium">{item.label}</p>
                        <p className="mt-0.5 break-words text-xs text-muted-foreground">
                          {physicalQrContextLabel(item.qrContextType, t)} · ×{item.quantity}
                        </p>
                        {order.paymentStatus === "PAID" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-2 h-auto w-full max-w-full whitespace-normal"
                            disabled={downloadingPdf}
                            onClick={() => void downloadPdf(item.id)}
                          >
                            {downloadingPdf && downloadingItemId === item.id
                              ? t("admin.physicalQr.preparingPdfs", { count: item.quantity })
                              : t("admin.physicalQr.downloadPdf")}
                          </Button>
                        ) : (
                          <p className="mt-2 text-xs text-muted-foreground">—</p>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="hidden max-w-full overflow-x-auto lg:block">
                <table className="pq-order-table">
                  <thead>
                    <tr>
                      <th>{t("admin.physicalQr.itemLabel")}</th>
                      <th>{t("admin.physicalQr.itemType")}</th>
                      <th className="text-right">{t("admin.physicalQr.itemQty")}</th>
                      <th className="text-right">{t("admin.physicalQr.itemActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedItems.map((group) => (
                      <Fragment key={group.locationName}>
                        {groupedItems.length > 1 ? (
                          <tr>
                            <td colSpan={4} className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {group.locationName}
                            </td>
                          </tr>
                        ) : null}
                        {group.items.map((item) => (
                          <tr key={item.id}>
                            <td className="max-w-[16rem] break-words font-medium">{item.label}</td>
                            <td className="whitespace-nowrap text-muted-foreground">
                              {physicalQrContextLabel(item.qrContextType, t)}
                            </td>
                            <td className="text-right tabular-nums">×{item.quantity}</td>
                            <td className="text-right">
                              {order.paymentStatus === "PAID" ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={downloadingPdf}
                                  onClick={() => void downloadPdf(item.id)}
                                >
                                  {downloadingPdf && downloadingItemId === item.id
                                    ? t("admin.physicalQr.preparingPdfs", { count: item.quantity })
                                    : t("admin.physicalQr.downloadPdf")}
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="font-medium">{physicalQrContextLabel(order.qrContextType, t)}</p>
          )}
        </section>

        <section className="pq-order-section" aria-labelledby="pq-admin-customer-heading">
          <h2 id="pq-admin-customer-heading" className="pq-order-section__title">
            {t("admin.physicalQr.sectionCustomer")}
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="pq-meta__label">{t("admin.physicalQr.business")}</p>
              <p className="pq-meta__value pq-meta__value--quiet">{order.businessName}</p>
            </div>
            <div className="min-w-0">
              <p className="pq-meta__label">{t("admin.physicalQr.deliveryAddress")}</p>
              <p className="pq-meta__value pq-meta__value--quiet">
                {shipTo || t("admin.physicalQr.deliveryNotCollected")}
              </p>
            </div>
            <div className="min-w-0">
              <p className="pq-meta__label">{t("admin.physicalQr.contact")}</p>
              <p className="pq-meta__value pq-meta__value--quiet break-words">
                {contact
                  ? [contact.name, contact.email, contact.phone].filter(Boolean).join(" · ")
                  : t("admin.physicalQr.deliveryNotCollected")}
              </p>
            </div>
            <div className="min-w-0">
              <p className="pq-meta__label">{t("business.qrStudio.physical.printedAddress")}</p>
              <p className="pq-meta__value pq-meta__value--quiet">
                {order.supportsAddress
                  ? address || t("business.qrStudio.physical.withAddress")
                  : t("business.qrStudio.physical.withoutAddress")}
              </p>
            </div>
            {order.qrTargetUrlSnapshot ? (
              <div className="min-w-0 sm:col-span-2">
                <p className="pq-meta__label">{t("admin.physicalQr.qrTarget")}</p>
                <p className="pq-meta__value pq-meta__value--quiet break-all">{order.qrTargetUrlSnapshot}</p>
              </div>
            ) : null}
          </div>
          {!shipTo ? (
            <p className="mt-3 break-words text-sm text-destructive">{t("admin.physicalQr.deliveryMissingWarning")}</p>
          ) : null}
        </section>

        <section className="pq-order-section" aria-labelledby="pq-admin-meta-heading">
          <h2 id="pq-admin-meta-heading" className="pq-order-section__title">
            {t("admin.physicalQr.sectionMeta")}
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="min-w-0">
              <p className="pq-meta__label">{t("business.qrStudio.physical.orders.orderTotalLabel")}</p>
              <p className="pq-meta__value pq-meta__value--total">
                {formatPhysicalQrMoney(order.totalAmount, order.currency, i18n.language)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="pq-meta__label">{t("business.qrStudio.physical.orders.placed")}</p>
              <p className="pq-meta__value pq-meta__value--quiet">
                {formatBerlinDateTime(order.placedAt, i18n.language)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="pq-meta__label">{t("business.qrStudio.physical.quantity")}</p>
              <p className="pq-meta__value pq-meta__value--quiet">{order.quantity}</p>
            </div>
            {order.stripePaymentIntentId ? (
              <div className="min-w-0 sm:col-span-2">
                <p className="pq-meta__label">{t("admin.physicalQr.paymentIntent")}</p>
                <p className="break-all text-sm">{order.stripePaymentIntentId}</p>
              </div>
            ) : null}
            <div className="min-w-0">
              <p className="pq-meta__label">{t("business.qrStudio.physical.orders.cutoff")}</p>
              <p className="pq-meta__value pq-meta__value--quiet">{physicalQrCutoffLabel(order.processingClass, t)}</p>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <p className="pq-meta__label">{t("business.qrStudio.physical.orders.estimatedFulfillment")}</p>
              <p className="pq-meta__value pq-meta__value--quiet">
                {physicalQrEstimatedFulfillmentLabel(order.processingClass, t)}
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{t("business.qrStudio.physical.deliveryAfterShip")}</p>
        </section>

        <section className="pq-order-section" aria-labelledby="pq-admin-notes-heading">
          <h2 id="pq-admin-notes-heading" className="pq-order-section__title">
            {t("admin.physicalQr.internalNotes")}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("admin.physicalQr.internalNotesHint")}</p>
          <div className="mb-3 space-y-3">
            {notes.map((note) => (
              <div key={note.id} className="border-b border-border/60 pb-3 text-sm last:border-0">
                <p className="text-xs text-muted-foreground">{formatBerlinDateTime(note.createdAt, i18n.language)}</p>
                <p className="mt-1 whitespace-pre-wrap break-words">{note.body}</p>
              </div>
            ))}
          </div>
          <Textarea rows={3} value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
          <Button
            type="button"
            className="mt-2"
            disabled={busy || !noteBody.trim()}
            onClick={() => {
              const text = noteBody.trim();
              void run(async () => {
                const note = await postPlatformPhysicalQrInternalNote(order.id, text);
                setNotes((prev) => [...prev, note]);
                setNoteBody("");
              });
            }}
          >
            {t("admin.physicalQr.addNote")}
          </Button>
        </section>
      </div>
    </PlatformPage>
  );
}
