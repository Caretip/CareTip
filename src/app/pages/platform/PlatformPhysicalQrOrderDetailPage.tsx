import { useCallback, useEffect, useState } from "react";
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
  physicalQrContactFromUnknown,
  physicalQrContextLabel,
  physicalQrCutoffLabel,
  physicalQrEstimatedFulfillmentLabel,
  physicalQrFulfillmentLabel,
  physicalQrOrderNumber,
  physicalQrPaymentLabel,
  physicalQrShippingLine,
} from "../../lib/physicalQrOrderUi";
import { PhysicalQrOrderTimeline } from "../../components/business/physical-branding/PhysicalQrOrderTimeline";
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

  const reload = useCallback(async () => {
    const data = await fetchPlatformPhysicalQrOrder(orderId);
    setOrder(data.order);
    setNotes(data.internalNotes);
    setCarrier(data.order.carrier ?? "");
    setTrackingNumber(data.order.trackingNumber ?? "");
    setTrackingUrl(data.order.trackingUrl ?? "");
  }, [orderId]);

  useEffect(() => {
    void reload().catch(() => toast.error(t("admin.physicalQr.loadError")));
  }, [reload, t]);

  async function downloadPdf(itemId?: string) {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    setDownloadingItemId(itemId ?? null);
    try {
      await downloadPlatformPhysicalQrOrderPrint(orderId, "pdf", itemId);
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

  if (!order) {
    return (
      <PlatformPage>
        <PlatformPhysicalQrOrderSkeleton />
      </PlatformPage>
    );
  }

  const address = physicalQrAddressLine(order.addressSnapshot);
  const shipTo = physicalQrShippingLine(order.shippingSnapshot);
  const contact = physicalQrContactFromUnknown(order.contactSnapshot);
  const totalPages = order.quantity;
  const bulkLabel =
    order.itemCount > 1 || totalPages > 1
      ? downloadingPdf && !downloadingItemId
        ? t("admin.physicalQr.preparingPdfs", { count: totalPages })
        : t("admin.physicalQr.downloadAllPdfs", { count: totalPages })
      : t("admin.physicalQr.downloadPdf");

  return (
    <PlatformPage>
      <Link to="/platform-admin/branding-orders" className={platformUi.backLink}>
        {t("admin.physicalQr.back")}
      </Link>
      <PlatformPageHeader
        icon={Package}
        title={t("business.qrStudio.physical.orders.orderNumber", { id: physicalQrOrderNumber(order.id) })}
        subtitle={order.businessName ?? ""}
      />

      <div className={`${platformUi.contentCard} mb-4 grid gap-3 text-sm sm:grid-cols-2`}>
        <div>
          <p className="text-muted-foreground">{t("admin.physicalQr.business")}</p>
          <p className="font-medium">{order.businessName}</p>
        </div>
        <div className="sm:col-span-2">
          <p className="text-muted-foreground">{t("admin.physicalQr.orderItems", { defaultValue: "Items" })}</p>
          {order.items.length > 0 ? (
            <>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("admin.physicalQr.orderItemsSummary", {
                  lines: order.itemCount,
                  copies: order.quantity,
                  defaultValue: "{{lines}} line items · {{copies}} total copies",
                })}
              </p>
              <div className="mt-2 overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[280px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t("admin.physicalQr.itemLabel", { defaultValue: "QR item" })}</th>
                      <th className="px-3 py-2 font-medium">{t("admin.physicalQr.itemType", { defaultValue: "Type" })}</th>
                      <th className="px-3 py-2 font-medium text-right">{t("admin.physicalQr.itemQty", { defaultValue: "Qty" })}</th>
                      <th className="px-3 py-2 font-medium text-right">{t("admin.physicalQr.itemActions", { defaultValue: "Print" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2 font-medium">{item.label}</td>
                        <td className="px-3 py-2 text-muted-foreground">{physicalQrContextLabel(item.qrContextType, t)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">×{item.quantity}</td>
                        <td className="px-3 py-2 text-right">
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
                  </tbody>
                </table>
              </div>
            </>
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
          <p className="text-muted-foreground">{t("admin.physicalQr.deliveryAddress")}</p>
          <p className="font-medium">{shipTo || t("admin.physicalQr.deliveryNotCollected")}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("admin.physicalQr.contact")}</p>
          <p className="font-medium">
            {contact
              ? [contact.name, contact.email, contact.phone].filter(Boolean).join(" · ")
              : t("admin.physicalQr.deliveryNotCollected")}
          </p>
        </div>
        {order.qrTargetUrlSnapshot ? (
          <div className="sm:col-span-2">
            <p className="text-muted-foreground">{t("admin.physicalQr.qrTarget")}</p>
            <p className="break-all font-medium">{order.qrTargetUrlSnapshot}</p>
          </div>
        ) : null}
        {order.stripePaymentIntentId ? (
          <div className="sm:col-span-2">
            <p className="text-muted-foreground">{t("admin.physicalQr.paymentIntent")}</p>
            <p className="break-all font-medium">{order.stripePaymentIntentId}</p>
          </div>
        ) : null}
        <div>
          <p className="text-muted-foreground">{t("business.qrStudio.physical.quantity")}</p>
          <p className="font-medium">{order.quantity}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("business.qrStudio.physical.orders.payment")}</p>
          <p className="font-medium">
            {formatPhysicalQrMoney(order.totalAmount, order.currency, i18n.language)} ·{" "}
            {physicalQrPaymentLabel(order.paymentStatus, t, { totalAmount: order.totalAmount })}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("business.qrStudio.physical.orders.placed")}</p>
          <p className="font-medium">{formatBerlinDateTime(order.placedAt, i18n.language)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("business.qrStudio.physical.orders.status")}</p>
          <p className="font-medium">
            {physicalQrFulfillmentLabel(order.fulfillmentStatus, t, { totalAmount: order.totalAmount })}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("business.qrStudio.physical.orders.cutoff")}</p>
          <p className="font-medium">{physicalQrCutoffLabel(order.processingClass, t)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("business.qrStudio.physical.orders.estimatedFulfillment")}</p>
          <p className="font-medium">{physicalQrEstimatedFulfillmentLabel(order.processingClass, t)}</p>
        </div>
        <p className="sm:col-span-2 text-muted-foreground">{t("business.qrStudio.physical.deliveryAfterShip")}</p>
        {!shipTo ? (
          <p className="sm:col-span-2 text-sm text-destructive">{t("admin.physicalQr.deliveryMissingWarning")}</p>
        ) : null}
      </div>

      <div className={`${platformUi.contentCard} mb-4`}>
        <p className="mb-3 font-medium">{t("business.qrStudio.physical.orders.progress")}</p>
        <PhysicalQrOrderTimeline order={order} />
      </div>

      <div className={`${platformUi.contentCard} mb-4 space-y-3`}>
        <p className="font-medium">
          {t("admin.physicalQr.currentStatus")}:{" "}
          {physicalQrFulfillmentLabel(order.fulfillmentStatus, t, { totalAmount: order.totalAmount })}
        </p>
        {order.paymentStatus === "PAID" ? (
          <Button type="button" variant="outline" disabled={downloadingPdf} onClick={() => void downloadPdf()}>
            {bulkLabel}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t("admin.physicalQr.printUnpaidHint")}</p>
        )}
        {order.fulfillmentStatus === "PAID" ? (
          <Button type="button" disabled={busy} onClick={() => void run(() => markPlatformPhysicalQrProcessing(order.id))}>
            {t("admin.physicalQr.markProcessing")}
          </Button>
        ) : null}
        {order.fulfillmentStatus === "PROCESSING" ? (
          <Button type="button" disabled={busy} onClick={() => void run(() => markPlatformPhysicalQrPrinting(order.id))}>
            {t("admin.physicalQr.markPrinting")}
          </Button>
        ) : null}
        {order.fulfillmentStatus === "PRINTING" ? (
          <div className="grid gap-3 sm:grid-cols-3">
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
        {order.fulfillmentStatus === "SHIPPED" ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t("admin.physicalQr.shippedAt")}: {order.shippedAt ? formatBerlinDateTime(order.shippedAt, i18n.language) : ""}
              {order.carrier ? ` · ${order.carrier}` : ""}
              {order.trackingNumber ? ` · ${order.trackingNumber}` : ""}
            </p>
            <Button type="button" disabled={busy} onClick={() => void run(() => deliverPlatformPhysicalQrOrder(order.id))}>
              {t("admin.physicalQr.markDelivered")}
            </Button>
          </div>
        ) : null}
      </div>

      <div className={platformUi.contentCard}>
        <p className="mb-1 font-medium">{t("admin.physicalQr.internalNotes")}</p>
        <p className="mb-3 text-xs text-muted-foreground">{t("admin.physicalQr.internalNotesHint")}</p>
        <div className="mb-3 space-y-2">
          {notes.map((note) => (
            <div key={note.id} className="rounded-md border border-border bg-muted/20 p-3 text-sm">
              <p className="text-xs text-muted-foreground">{formatBerlinDateTime(note.createdAt, i18n.language)}</p>
              <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
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
      </div>
    </PlatformPage>
  );
}
