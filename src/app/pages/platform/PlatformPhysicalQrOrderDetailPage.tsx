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
  releasePlatformPhysicalQrHold,
  shipPlatformPhysicalQrOrder,
  type PhysicalQrAdminOrder,
  type PhysicalQrHoldResolution,
  type PhysicalQrInternalNote,
} from "../../lib/api";
import {
  isPhysicalQrFulfillable,
  physicalQrFulfillmentHoldKey,
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
  physicalQrTimeline,
  groupPhysicalQrItemsByLocation,
} from "../../lib/physicalQrOrderUi";
import { PlatformPhysicalQrOrderSkeleton } from "../../components/business/qr-studio/QrStudioLoadingSkeletons";
import {
  ConsoleCallout,
  ConsoleCard,
  ConsoleDl,
  ConsoleHeader,
  ConsoleKv,
  ConsolePage,
  ConsoleStatus,
  ConsoleSteps,
  ConsoleTable,
  ConsoleTimeline,
  type ConsoleStepState,
} from "../../components/platform/console/AdminConsole";
import { qrFulfillmentTone, qrPaymentTone } from "../../components/platform/console/consoleTones";
import { PLATFORM_BRANDING_ORDERS_BASE, PLATFORM_BUSINESS_BASE } from "../../components/platform/platformAdminNav";
import {
  Building2,
  CheckCircle2,
  Download,
  FileText,
  Lock,
  MessageSquareLock,
  Package,
  PackageCheck,
  Printer,
  ShieldAlert,
  Truck,
  Unlock,
} from "lucide-react";
import { toDisplayErrorMessage } from "@/app/lib/errorMessages";

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
  const [holdResolutions, setHoldResolutions] = useState<PhysicalQrHoldResolution[]>([]);
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseConfirming, setReleaseConfirming] = useState(false);
  const [releasing, setReleasing] = useState(false);

  const reload = useCallback(async () => {
    const data = await fetchPlatformPhysicalQrOrder(orderId);
    setOrder(data.order);
    setNotes(data.internalNotes);
    setHoldResolutions(data.holdResolutions ?? []);
    setCarrier(data.order.carrier ?? "");
    setTrackingNumber(data.order.trackingNumber ?? "");
    setTrackingUrl(data.order.trackingUrl ?? "");
    setLoadError(null);
  }, [orderId]);

  useEffect(() => {
    void reload().catch((err) => {
      setLoadError(toDisplayErrorMessage(err, t("admin.physicalQr.loadError")));
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
      toast.error(toDisplayErrorMessage(err, t("admin.physicalQr.downloadPdfError")));
    } finally {
      setDownloadingPdf(false);
      setDownloadingItemId(null);
    }
  }

  async function releaseHold() {
    if (!order || releasing) return;
    setReleasing(true);
    try {
      await releasePlatformPhysicalQrHold(order.id, {
        reason: releaseReason.trim(),
        expectedPaymentStatus: order.paymentStatus,
      });
      toast.success(t("admin.physicalQr.releaseDone"));
      setReleaseReason("");
      setReleaseConfirming(false);
      await reload();
    } catch (err) {
      // Server messages explain exactly why (Stripe state, open findings, changed order).
      toast.error(toDisplayErrorMessage(err, t("admin.physicalQr.releaseError")));
      setReleaseConfirming(false);
    } finally {
      setReleasing(false);
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (err) {
      toast.error(toDisplayErrorMessage(err, t("admin.physicalQr.actionError")));
    } finally {
      setBusy(false);
    }
  }

  const back = { href: PLATFORM_BRANDING_ORDERS_BASE, label: t("admin.physicalQr.back") };

  if (loadError) {
    return (
      <ConsolePage className="platform-physical-qr">
        <ConsoleHeader back={back} icon={Package} title={t("admin.physicalQr.title")} />
        <ConsoleCallout tone="failure" title={t("admin.physicalQr.loadError")}>
          {loadError}
        </ConsoleCallout>
      </ConsolePage>
    );
  }

  if (!order) {
    return (
      <ConsolePage className="platform-physical-qr">
        <PlatformPhysicalQrOrderSkeleton />
      </ConsolePage>
    );
  }

  const lang = i18n.language;
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
  // Forward fulfillment (processing, printing, shipping) needs a fully paid order; the server enforces it too.
  const fulfillable = isPhysicalQrFulfillable(order.paymentStatus, order.holdReleasedAt);
  const holdKey = physicalQrFulfillmentHoldKey(order.paymentStatus, order.holdReleasedAt);
  const releasable =
    order.paymentStatus === "IN_REVIEW" || (order.paymentStatus === "PARTIALLY_REFUNDED" && !order.holdReleasedAt);
  const reasonLength = releaseReason.trim().length;
  const reasonOk = reasonLength >= 10 && reasonLength <= 1000;
  const fulfillmentLabel = physicalQrFulfillmentLabel(order.fulfillmentStatus, t, {
    totalAmount: order.totalAmount,
  });

  // Pipeline: first unfinished step is "current"; it is "blocked" while payment holds fulfilment.
  const timeline = physicalQrTimeline(order, t);
  const firstOpen = timeline.findIndex((s) => !s.done);
  const stopped = Boolean(holdKey) || ["CANCELLED", "PAYMENT_FAILED"].includes(order.fulfillmentStatus);
  const steps = timeline.map((s, i) => ({
    key: s.id,
    label: s.label,
    time: s.at ? formatBerlinDateTime(s.at, lang) : null,
    state: (s.done ? "done" : i === firstOpen ? (stopped ? "blocked" : "current") : "upcoming") as ConsoleStepState,
  }));
  const hasForwardAction =
    (fulfillable && ["PAID", "PROCESSING", "PRINTING"].includes(order.fulfillmentStatus)) ||
    order.fulfillmentStatus === "SHIPPED";

  return (
    <ConsolePage className="platform-physical-qr">
      <ConsoleHeader
        back={back}
        icon={Package}
        title={t("business.qrStudio.physical.orders.orderNumber", { id: physicalQrOrderNumber(order.id) })}
        status={
          <span className="inline-flex flex-wrap gap-1.5">
            <ConsoleStatus size="lg" tone={qrPaymentTone(order.paymentStatus)}>
              {paymentLabel}
            </ConsoleStatus>
            <ConsoleStatus size="lg" tone={holdKey ? "neutral" : qrFulfillmentTone(order.fulfillmentStatus)}>
              {fulfillmentLabel}
            </ConsoleStatus>
          </span>
        }
        description={
          order.businessName ? (
            <Link to={`${PLATFORM_BUSINESS_BASE}/${order.businessId}`} className="ac-link" style={{ fontSize: "0.9rem" }}>
              <Building2 aria-hidden />
              {order.businessName}
            </Link>
          ) : null
        }
        meta={
          <>
            <span>
              {t("business.qrStudio.physical.orders.placed")}: {formatBerlinDateTime(order.placedAt, lang)}
            </span>
            <span>
              {t("business.qrStudio.physical.orders.orderTotalLabel")}:{" "}
              <b className="text-foreground">{formatPhysicalQrMoney(order.totalAmount, order.currency, lang)}</b>
            </span>
          </>
        }
        actions={
          fulfillable ? (
            <button type="button" className="ac-btn ac-btn--secondary" disabled={downloadingPdf} onClick={() => void downloadPdf()}>
              <Download aria-hidden />
              {bulkLabel}
            </button>
          ) : null
        }
      />

      <div className="ac-grid ac-grid--main-aside">
        <div className="ac-stack ac-stack--lg">
          {/* Fulfillment: where the order is, what blocks it, and the one next action */}
          <ConsoleCard
            id="pq-fulfillment"
            icon={Truck}
            title={t("admin.physicalQr.colFulfillment")}
            description={
              <>
                {t("admin.physicalQr.nextAction")}: <b className="text-foreground">{nextStep ?? t("admin.physicalQr.nextNone")}</b>
              </>
            }
          >
            <div className="flex flex-col gap-5">
              <ConsoleSteps steps={steps} label={t("admin.physicalQr.colFulfillment")} />

              {holdKey ? (
                <ConsoleCallout
                  tone={order.paymentStatus === "REFUNDED" || order.paymentStatus === "DISPUTED" ? "failure" : "attention"}
                  icon={Lock}
                  title={t("admin.physicalQr.holdTitle")}
                >
                  <span role="status">{t(holdKey)}</span>
                  {order.paymentStatus === "REFUNDED" ? (
                    <span className="mt-1 block text-xs">{t("admin.physicalQr.holdNotReleasableRefunded")}</span>
                  ) : null}
                  {order.paymentStatus === "DISPUTED" ? (
                    <span className="mt-1 block text-xs">{t("admin.physicalQr.holdNotReleasableDisputed")}</span>
                  ) : null}
                </ConsoleCallout>
              ) : null}

              {order.paymentStatus === "PARTIALLY_REFUNDED" && order.holdReleasedAt ? (
                <ConsoleCallout tone="info" icon={Unlock}>
                  <span role="status">{t("admin.physicalQr.holdReleasedNotice")}</span>
                </ConsoleCallout>
              ) : null}

              {!fulfillable && !holdKey ? (
                <p className="ac-small ac-muted">{t("admin.physicalQr.printUnpaidHint")}</p>
              ) : null}

              {hasForwardAction ? (
                <div className="platform-physical-qr__actions pq-admin-actions flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                  {fulfillable && order.fulfillmentStatus === "PAID" ? (
                    <button
                      type="button"
                      className="ac-btn ac-btn--primary"
                      disabled={busy}
                      onClick={() => void run(() => markPlatformPhysicalQrProcessing(order.id))}
                    >
                      <PackageCheck aria-hidden />
                      {t("admin.physicalQr.markProcessing")}
                    </button>
                  ) : null}
                  {fulfillable && order.fulfillmentStatus === "PROCESSING" ? (
                    <button
                      type="button"
                      className="ac-btn ac-btn--primary"
                      disabled={busy}
                      onClick={() => void run(() => markPlatformPhysicalQrPrinting(order.id))}
                    >
                      <Printer aria-hidden />
                      {t("admin.physicalQr.markPrinting")}
                    </button>
                  ) : null}
                  {order.fulfillmentStatus === "SHIPPED" ? (
                    <button
                      type="button"
                      className="ac-btn ac-btn--primary"
                      disabled={busy}
                      onClick={() => void run(() => deliverPlatformPhysicalQrOrder(order.id))}
                    >
                      <CheckCircle2 aria-hidden />
                      {t("admin.physicalQr.markDelivered")}
                    </button>
                  ) : null}
                  {fulfillable && order.fulfillmentStatus === "PRINTING" ? (
                    <form
                      className="grid w-full gap-3 sm:grid-cols-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(() =>
                          shipPlatformPhysicalQrOrder(order.id, {
                            carrier,
                            trackingNumber,
                            trackingUrl: trackingUrl || undefined,
                          }),
                        );
                      }}
                    >
                      <label className="ac-field">
                        <span className="ac-field__label">{t("admin.physicalQr.carrier")}</span>
                        <input className="ac-input" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
                      </label>
                      <label className="ac-field">
                        <span className="ac-field__label">{t("admin.physicalQr.trackingNumber")}</span>
                        <input className="ac-input" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
                      </label>
                      <label className="ac-field">
                        <span className="ac-field__label">{t("admin.physicalQr.trackingUrl")}</span>
                        <input className="ac-input" type="url" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} />
                      </label>
                      <div className="sm:col-span-3">
                        <button type="submit" className="ac-btn ac-btn--primary" disabled={busy}>
                          <Truck aria-hidden />
                          {t("admin.physicalQr.markShipped")}
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </div>
          </ConsoleCard>

          {releasable ? (
            <ConsoleCard
              id="pq-release"
              tone="accent"
              icon={ShieldAlert}
              title={t("admin.physicalQr.releaseTitle")}
              description={
                order.paymentStatus === "IN_REVIEW"
                  ? t("admin.physicalQr.releaseHelpInReview")
                  : t("admin.physicalQr.releaseHelpPartial")
              }
            >
              <div className="flex flex-col gap-3" data-testid="pq-release-hold">
                <label className="ac-field" htmlFor="pq-release-reason">
                  <span className="ac-field__label">{t("admin.physicalQr.releaseReasonLabel")}</span>
                  <textarea
                    id="pq-release-reason"
                    className="ac-textarea"
                    value={releaseReason}
                    maxLength={1000}
                    disabled={releasing}
                    onChange={(e) => {
                      setReleaseReason(e.target.value);
                      setReleaseConfirming(false);
                    }}
                  />
                  <span className="ac-field__hint">
                    {t("admin.physicalQr.releaseReasonHint")} ({reasonLength}/1000)
                  </span>
                </label>
                {releaseConfirming ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="ac-btn ac-btn--primary" disabled={!reasonOk || releasing} onClick={() => void releaseHold()}>
                      {t("admin.physicalQr.releaseConfirm")}
                    </button>
                    <button type="button" className="ac-btn ac-btn--secondary" disabled={releasing} onClick={() => setReleaseConfirming(false)}>
                      {t("admin.physicalQr.releaseCancel")}
                    </button>
                  </div>
                ) : (
                  <div>
                    <button type="button" className="ac-btn ac-btn--secondary" disabled={!reasonOk} onClick={() => setReleaseConfirming(true)}>
                      {t("admin.physicalQr.releaseReview")}
                    </button>
                  </div>
                )}
              </div>
            </ConsoleCard>
          ) : null}

          <ConsoleCard
            id="pq-admin-items"
            icon={FileText}
            title={t("admin.physicalQr.orderItems")}
            description={
              order.items.length > 0
                ? t("admin.physicalQr.orderItemsSummary", { lines: order.itemCount, copies: order.quantity })
                : undefined
            }
            flush
          >
            {order.items.length > 0 ? (
              <ConsoleTable label={t("admin.physicalQr.orderItems")}>
                <thead>
                  <tr>
                    <th>{t("admin.physicalQr.itemLabel")}</th>
                    <th>{t("admin.physicalQr.itemType")}</th>
                    <th className="ac-num">{t("admin.physicalQr.itemQty")}</th>
                    <th className="ac-actions">{t("admin.physicalQr.itemActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedItems.map((group) => (
                    <Fragment key={group.locationName}>
                      {groupedItems.length > 1 ? (
                        <tr>
                          <td colSpan={4} className="ac-section-label" style={{ margin: 0, paddingTop: "0.9rem" }}>
                            {group.locationName}
                          </td>
                        </tr>
                      ) : null}
                      {group.items.map((item) => (
                        <tr key={item.id}>
                          <td data-primary className="ac-cell-primary">
                            {item.label}
                          </td>
                          <td data-label={t("admin.physicalQr.itemType")}>{physicalQrContextLabel(item.qrContextType, t)}</td>
                          <td data-label={t("admin.physicalQr.itemQty")} className="ac-num">
                            ×{item.quantity}
                          </td>
                          <td className="ac-actions">
                            {fulfillable ? (
                              <button
                                type="button"
                                className="ac-btn ac-btn--secondary ac-btn--sm"
                                disabled={downloadingPdf}
                                onClick={() => void downloadPdf(item.id)}
                              >
                                <Download aria-hidden />
                                {downloadingPdf && downloadingItemId === item.id
                                  ? t("admin.physicalQr.preparingPdfs", { count: item.quantity })
                                  : t("admin.physicalQr.downloadPdf")}
                              </button>
                            ) : (
                              <span className="ac-muted" aria-hidden>
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </ConsoleTable>
            ) : (
              <div className="ac-card__body">
                <p className="font-medium">{physicalQrContextLabel(order.qrContextType, t)}</p>
              </div>
            )}
          </ConsoleCard>

          <ConsoleCard id="pq-admin-customer" icon={Building2} title={t("admin.physicalQr.sectionCustomer")}>
            <div className="flex flex-col gap-4">
              {!shipTo ? (
                <ConsoleCallout tone="failure">{t("admin.physicalQr.deliveryMissingWarning")}</ConsoleCallout>
              ) : null}
              <ConsoleDl
                items={[
                  { label: t("admin.physicalQr.business"), value: order.businessName ?? "—" },
                  { label: t("admin.physicalQr.deliveryAddress"), value: shipTo || t("admin.physicalQr.deliveryNotCollected") },
                  {
                    label: t("admin.physicalQr.contact"),
                    value: contact
                      ? [contact.name, contact.email, contact.phone].filter(Boolean).join(" · ")
                      : t("admin.physicalQr.deliveryNotCollected"),
                  },
                  {
                    label: t("business.qrStudio.physical.printedAddress"),
                    value: order.supportsAddress
                      ? address || t("business.qrStudio.physical.withAddress")
                      : t("business.qrStudio.physical.withoutAddress"),
                  },
                  ...(order.qrTargetUrlSnapshot
                    ? [{ label: t("admin.physicalQr.qrTarget"), value: <span className="break-all">{order.qrTargetUrlSnapshot}</span>, full: true }]
                    : []),
                ]}
              />
            </div>
          </ConsoleCard>

          <ConsoleCard
            id="pq-admin-notes"
            icon={MessageSquareLock}
            title={t("admin.physicalQr.internalNotes")}
            description={t("admin.physicalQr.internalNotesHint")}
          >
            <div className="flex flex-col gap-4">
              {notes.length ? (
                <ConsoleTimeline
                  items={notes.map((note) => ({
                    key: note.id,
                    state: "done",
                    title: <span className="whitespace-pre-wrap break-words font-normal">{note.body}</span>,
                    meta: formatBerlinDateTime(note.createdAt, lang),
                  }))}
                />
              ) : null}
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = noteBody.trim();
                  if (!text) return;
                  void run(async () => {
                    const note = await postPlatformPhysicalQrInternalNote(order.id, text);
                    setNotes((prev) => [...prev, note]);
                    setNoteBody("");
                  });
                }}
              >
                <textarea
                  className="ac-textarea"
                  rows={3}
                  value={noteBody}
                  aria-label={t("admin.physicalQr.internalNotes")}
                  onChange={(e) => setNoteBody(e.target.value)}
                />
                <div>
                  <button type="submit" className="ac-btn ac-btn--secondary" disabled={busy || !noteBody.trim()}>
                    {t("admin.physicalQr.addNote")}
                  </button>
                </div>
              </form>
            </div>
          </ConsoleCard>
        </div>

        <aside className="ac-stack ac-sticky" aria-label={t("admin.physicalQr.sectionMeta")}>
          <ConsoleCard id="pq-admin-meta" title={t("admin.physicalQr.sectionMeta")}>
            <p className="ac-small ac-muted">{t("business.qrStudio.physical.orders.orderTotalLabel")}</p>
            <p className="ac-big-number mt-1">{formatPhysicalQrMoney(order.totalAmount, order.currency, lang)}</p>
            <div className="mt-4">
              <ConsoleKv
                items={[
                  { label: t("admin.physicalQr.colPayment"), value: paymentLabel },
                  ...(order.paidAt ? [{ label: t("business.qrStudio.physical.orders.stepPaid"), value: formatBerlinDateTime(order.paidAt, lang) }] : []),
                  { label: t("business.qrStudio.physical.orders.placed"), value: formatBerlinDateTime(order.placedAt, lang) },
                  { label: t("business.qrStudio.physical.quantity"), value: order.quantity },
                  { label: t("business.qrStudio.physical.orders.cutoff"), value: physicalQrCutoffLabel(order.processingClass, t) },
                ]}
              />
            </div>
            <div className="mt-4 border-t border-border/60 pt-4">
              <ConsoleDl
                columns={1}
                items={[
                  {
                    label: t("business.qrStudio.physical.orders.estimatedFulfillment"),
                    value: physicalQrEstimatedFulfillmentLabel(order.processingClass, t),
                  },
                  ...(order.stripePaymentIntentId
                    ? [{ label: t("admin.physicalQr.paymentIntent"), value: <span className="ac-mono break-all">{order.stripePaymentIntentId}</span> }]
                    : []),
                ]}
              />
              <p className="ac-small ac-muted mt-3">{t("business.qrStudio.physical.deliveryAfterShip")}</p>
            </div>
          </ConsoleCard>

          {order.fulfillmentStatus === "SHIPPED" || order.fulfillmentStatus === "DELIVERED" ? (
            <ConsoleCard icon={Truck} title={t("admin.physicalQr.shippedAt")}>
              <ConsoleKv
                items={[
                  ...(order.shippedAt ? [{ label: t("admin.physicalQr.shippedAt"), value: formatBerlinDateTime(order.shippedAt, lang) }] : []),
                  { label: t("admin.physicalQr.carrier"), value: order.carrier ?? "—" },
                  { label: t("admin.physicalQr.trackingNumber"), value: <span className="ac-mono">{order.trackingNumber ?? "—"}</span> },
                ]}
              />
              {order.trackingUrl ? (
                <a href={order.trackingUrl} target="_blank" rel="noreferrer noopener" className="ac-link mt-3">
                  {t("admin.physicalQr.trackingUrl")}
                </a>
              ) : null}
            </ConsoleCard>
          ) : null}

          {holdResolutions.length ? (
          <ConsoleCard icon={ShieldAlert} title={t("admin.physicalQr.resolutionHistory")}>
              <ConsoleTimeline
                items={holdResolutions.map((r) => ({
                  key: r.id,
                  state: "done",
                  title: t("admin.physicalQr.resolutionEntry", {
                    from: physicalQrPaymentLabel(r.previousPaymentStatus, t),
                    to: physicalQrPaymentLabel(r.newPaymentStatus, t),
                  }),
                  meta: (
                    <>
                      {formatBerlinDateTime(r.createdAt, lang)}
                      <span className="mt-1 block break-words text-foreground">{r.reason}</span>
                    </>
                  ),
                }))}
              />
          </ConsoleCard>
          ) : null}
        </aside>
      </div>
    </ConsolePage>
  );
}
