import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStaleExternalStripeStateReset } from "@/app/hooks/useStaleExternalStripeStateReset";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronRight, CreditCard, Package, PackageCheck, Plus, Receipt, Truck } from "lucide-react";
import { checkoutPhysicalQrOrder, fetchPhysicalQrOrders, type PhysicalQrCustomerOrder } from "@/app/lib/api";
import { performExternalStripeRedirect } from "@/app/lib/externalStripeRedirect";
import {
  readPhysicalQrOrdersSnapshot,
  writePhysicalQrOrdersSnapshot,
} from "@/app/lib/physicalQrOrdersSessionCache";
import {
  formatBerlinDateCompact,
  formatPhysicalQrMoney,
  physicalQrContextLabel,
  physicalQrCustomerStatus,
  physicalQrOrderNumber,
  physicalQrTemplateDisplayName,
  physicalQrTimeline,
  type PhysicalQrStatusTone,
} from "@/app/lib/physicalQrOrderUi";
import { QrStudioOrderListSkeleton } from "@/app/components/business/qr-studio/QrStudioLoadingSkeletons";
import { QR_STUDIO_BASE } from "@/app/components/business/businessDashboardNav";
import {
  ConsoleCallout,
  ConsoleCard,
  ConsoleEmpty,
  ConsoleHeader,
  ConsoleKpi,
  ConsoleKpiGrid,
  ConsoleSearch,
  ConsoleSegments,
  ConsoleStatus,
  ConsoleSteps,
  ConsoleTable,
  ConsoleToolbar,
  useRowLink,
  type ConsoleStepState,
  type ConsoleTone,
} from "@/app/components/platform/console/AdminConsole";
import { formatRelative } from "@/app/components/platform/console/consoleFormat";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { toDisplayErrorMessage } from "@/app/lib/errorMessages";

type OrderGroup = "needsPayment" | "active" | "delivered" | "other";
type Filter = "all" | OrderGroup;

const TONE: Record<PhysicalQrStatusTone, ConsoleTone> = {
  placed: "neutral",
  pending: "attention",
  confirming: "info",
  paid: "success",
  processing: "info",
  printing: "info",
  shipped: "info",
  delivered: "success",
  failed: "failure",
  cancelled: "neutral",
};

function canPayOrder(order: PhysicalQrCustomerOrder): boolean {
  return Boolean(
    order.canPay ??
      ((order.paymentStatus === "PENDING" && order.fulfillmentStatus === "PENDING_PAYMENT") ||
        (order.paymentStatus === "FAILED" && order.fulfillmentStatus === "PAYMENT_FAILED")),
  );
}

/** One bucket per order, matching how a business thinks about its orders. */
function orderGroup(order: PhysicalQrCustomerOrder): OrderGroup {
  if (canPayOrder(order)) return "needsPayment";
  if (order.fulfillmentStatus === "DELIVERED") return "delivered";
  const settled = ["PAID"].includes(order.paymentStatus);
  if (settled && ["PAID", "PROCESSING", "PRINTING", "SHIPPED"].includes(order.fulfillmentStatus)) return "active";
  return "other";
}

const PAID_STATUSES = new Set(["PAID", "PARTIALLY_REFUNDED"]);

export function QrStudioOrdersPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { user } = useRequireAuth();
  const businessId = user?.businessId?.trim() || "";
  const initial = readPhysicalQrOrdersSnapshot(businessId);
  const [orders, setOrders] = useState<PhysicalQrCustomerOrder[]>(() => initial?.orders ?? []);
  const [loading, setLoading] = useState(() => !initial);
  const [error, setError] = useState<string | null>(null);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const resetPayLaunch = useCallback(() => setPayingOrderId(null), []);
  useStaleExternalStripeStateReset({ onReset: resetPayLaunch });
  const rowLink = useRowLink();

  const reload = useCallback(async () => {
    try {
      const data = await fetchPhysicalQrOrders({ revalidate: true });
      const next = data.orders ?? [];
      setOrders(next);
      setError(null);
      if (businessId) writePhysicalQrOrdersSnapshot(businessId, next);
    } catch (err) {
      if (!readPhysicalQrOrdersSnapshot(businessId)) {
        setError(toDisplayErrorMessage(err, t("business.qrStudio.physical.loadError")));
      }
    }
  }, [businessId, t]);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    const snap = readPhysicalQrOrdersSnapshot(businessId);
    if (snap) {
      setOrders(snap.orders);
      setLoading(false);
      setError(null);
    }
    void (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, reload]);

  // Synchronous guard: one checkout request at a time, even on a fast double click.
  const payInFlight = useRef(false);
  const payOrder = useCallback(
    async (id: string) => {
      if (payInFlight.current) return;
      payInFlight.current = true;
      setPayingOrderId(id);
      try {
        const session = await checkoutPhysicalQrOrder(id);
        const redirected = performExternalStripeRedirect(session.url, "checkout");
        if (!redirected.ok) {
          throw new Error(t("business.qrStudio.physical.orderError"));
        }
      } catch (err) {
        toast.error(toDisplayErrorMessage(err, t("business.qrStudio.physical.orderError")));
        setPayingOrderId(null);
        payInFlight.current = false;
      }
    },
    [t],
  );

  const grouped = useMemo(() => {
    const byGroup: Record<OrderGroup, PhysicalQrCustomerOrder[]> = { needsPayment: [], active: [], delivered: [], other: [] };
    for (const o of orders) byGroup[orderGroup(o)].push(o);
    return byGroup;
  }, [orders]);

  const totals = useMemo(() => {
    const paid = orders.filter((o) => PAID_STATUSES.has(o.paymentStatus));
    const spent = paid.reduce((s, o) => s + o.totalAmount, 0);
    const currency = orders[0]?.currency ?? "EUR";
    const last = [...orders].sort((a, b) => b.placedAt.localeCompare(a.placedAt))[0];
    return { spent, currency, last };
  }, [orders]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^#/, "");
    return orders
      .filter((o) => filter === "all" || orderGroup(o) === filter)
      .filter((o) => !needle || physicalQrOrderNumber(o.id).toLowerCase().includes(needle))
      .sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  }, [filter, orders, q]);

  const orderHref = (id: string) => `${QR_STUDIO_BASE}/orders/${id}`;
  const productLabel = (o: PhysicalQrCustomerOrder) =>
    physicalQrTemplateDisplayName(t, { templateId: o.templateId, productName: o.productName });
  const itemSummary = (o: PhysicalQrCustomerOrder) =>
    o.itemCount > 1
      ? t("business.qrStudio.physical.orders.itemCount", { count: o.itemCount, defaultValue: "{{count}} QR items" })
      : physicalQrContextLabel(o.qrContextType, t);
  const payLabel = (o: PhysicalQrCustomerOrder) =>
    o.paymentStatus === "FAILED" || o.fulfillmentStatus === "PAYMENT_FAILED"
      ? t("business.qrStudio.physical.orders.tryPaymentAgain")
      : t("business.qrStudio.physical.payNow");

  const header = (
    <ConsoleHeader
      icon={Receipt}
      crumbs={[{ label: t("business.qrStudio.title"), href: QR_STUDIO_BASE }, { label: t("business.qrStudio.nav.orders") }]}
      title={t("business.qrStudio.nav.orders")}
      description={t("business.qrStudio.orders.subtitle")}
      actions={
        <Link to={`${QR_STUDIO_BASE}/print`} className="ac-btn ac-btn--primary">
          <Plus aria-hidden />
          {t("business.qrStudio.overview.startOrder")}
        </Link>
      }
    />
  );

  return (
    <div className="qr-studio-orders ac flex flex-col gap-5 max-lg:gap-4">
      {header}

      {loading ? (
        <QrStudioOrderListSkeleton />
      ) : error ? (
        <ConsoleCallout
          tone="failure"
          action={
            <button
              type="button"
              className="ac-btn ac-btn--secondary ac-btn--sm"
              onClick={() => {
                setLoading(true);
                void reload().finally(() => setLoading(false));
              }}
            >
              {t("admin.retry")}
            </button>
          }
        >
          {error}
        </ConsoleCallout>
      ) : orders.length === 0 ? (
        <ConsoleCard>
          <ConsoleEmpty
            icon={Package}
            title={t("business.qrStudio.orders.emptyTitle")}
            description={t("business.qrStudio.orders.emptyDesc")}
            action={
              <Link to={`${QR_STUDIO_BASE}/print`} className="ac-btn ac-btn--primary">
                {t("business.qrStudio.overview.startOrder")}
              </Link>
            }
          />
        </ConsoleCard>
      ) : (
        <>
          {/* 1 · Payment the business still owes — the only thing that blocks production */}
          {grouped.needsPayment.length > 0 ? (
            <ConsoleCard
              tone="accent"
              icon={CreditCard}
              title={t("business.console.orders.filterNeedsPayment")}
              description={t("business.console.orders.needsPaymentDesc")}
              actions={<ConsoleStatus tone="attention">{grouped.needsPayment.length}</ConsoleStatus>}
              flush
            >
              <ul className="ac-list">
                {grouped.needsPayment.map((o) => {
                  const status = physicalQrCustomerStatus(o, t);
                  return (
                    <li key={o.id} className="ac-list-row flex-wrap">
                      <div className="ac-list-row__main basis-full sm:basis-0">
                        <p className="ac-list-row__title">
                          <Link to={orderHref(o.id)} className="hover:underline">
                            #{physicalQrOrderNumber(o.id)}
                          </Link>{" "}
                          <span className="ml-1 align-middle">
                            <ConsoleStatus tone={TONE[status.tone]}>{status.title}</ConsoleStatus>
                          </span>
                        </p>
                        <p className="ac-list-row__sub">
                          {productLabel(o)} · {itemSummary(o)} · {formatBerlinDateCompact(o.placedAt, lang)}
                        </p>
                      </div>
                      <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                        <span className="text-base font-bold tabular-nums">{formatPhysicalQrMoney(o.totalAmount, o.currency, lang)}</span>
                        <button
                          type="button"
                          className="ac-btn ac-btn--primary"
                          disabled={payingOrderId === o.id}
                          onClick={() => void payOrder(o.id)}
                        >
                          {payLabel(o)}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ConsoleCard>
          ) : null}

          {/* 2 · At a glance */}
          <ConsoleKpiGrid columns={4} label={t("business.qrStudio.nav.orders")}>
            <ConsoleKpi icon={Truck} tone="info" label={t("business.console.orders.kpiInProgress")} value={String(grouped.active.length)} />
            <ConsoleKpi icon={PackageCheck} tone="success" label={t("business.qrStudio.physical.orders.delivered")} value={String(grouped.delivered.length)} />
            <ConsoleKpi
              icon={Receipt}
              label={t("business.console.orders.kpiSpent")}
              value={formatPhysicalQrMoney(totals.spent, totals.currency, lang)}
              hint={t("business.console.orders.kpiOrders", { count: orders.length })}
            />
            <ConsoleKpi
              icon={Package}
              label={t("business.console.orders.kpiLastOrder")}
              value={totals.last ? formatRelative(totals.last.placedAt, lang) : "—"}
              hint={totals.last ? `#${physicalQrOrderNumber(totals.last.id)}` : undefined}
            />
          </ConsoleKpiGrid>

          {/* 3 · Where each paid order is right now */}
          {grouped.active.length > 0 ? (
            <section aria-labelledby="orders-active-title" className="flex flex-col gap-3">
              <h2 id="orders-active-title" className="ac-section-label" style={{ marginBottom: 0 }}>
                {t("business.console.orders.activeTitle")}
              </h2>
              <div className="ac-grid ac-grid--2">
                {grouped.active.map((o) => {
                  const status = physicalQrCustomerStatus(o, t);
                  const timeline = physicalQrTimeline(o, t);
                  const firstOpen = timeline.findIndex((s) => !s.done);
                  return (
                    <ConsoleCard
                      key={o.id}
                      title={
                        <Link to={orderHref(o.id)} className="hover:underline">
                          #{physicalQrOrderNumber(o.id)}
                        </Link>
                      }
                      description={`${productLabel(o)} · ${itemSummary(o)} · ${t("business.qrStudio.physical.orders.qtyShort", { count: o.quantity })}`}
                      actions={<ConsoleStatus tone={TONE[status.tone]}>{status.title}</ConsoleStatus>}
                      footer={
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {o.trackingNumber ? (
                              <>
                                {o.carrier ? `${o.carrier} · ` : ""}
                                <span className="ac-mono text-foreground">{o.trackingNumber}</span>
                              </>
                            ) : (
                              formatBerlinDateCompact(o.placedAt, lang)
                            )}
                          </span>
                          <Link to={orderHref(o.id)} className="ac-link">
                            {t("business.qrStudio.physical.orders.viewOrder")}
                            <ChevronRight aria-hidden />
                          </Link>
                        </span>
                      }
                    >
                      <ConsoleSteps
                        label={t("business.qrStudio.physical.orders.progress")}
                        steps={timeline.map((s, i) => ({
                          key: s.id,
                          label: s.label,
                          time: s.at ? formatBerlinDateCompact(s.at, lang) : null,
                          state: (s.done ? "done" : i === firstOpen ? "current" : "upcoming") as ConsoleStepState,
                        }))}
                      />
                      {status.detail ? <p className="ac-small ac-muted mt-4">{status.detail}</p> : null}
                    </ConsoleCard>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* 4 · Full history */}
          <ConsoleCard title={t("business.console.orders.allTitle")} flush>
            <ConsoleToolbar
              start={
                <ConsoleSegments
                  label={t("business.qrStudio.physical.orders.status")}
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all" as Filter, label: t("business.console.orders.filterAll"), count: orders.length },
                    { value: "needsPayment" as Filter, label: t("business.console.orders.filterNeedsPayment"), count: grouped.needsPayment.length },
                    { value: "active" as Filter, label: t("business.console.orders.kpiInProgress"), count: grouped.active.length },
                    { value: "delivered" as Filter, label: t("business.qrStudio.physical.orders.delivered"), count: grouped.delivered.length },
                    { value: "other" as Filter, label: t("business.console.orders.filterOther"), count: grouped.other.length },
                  ]}
                />
              }
              end={
                <ConsoleSearch
                  value={q}
                  onChange={setQ}
                  placeholder={t("business.console.orders.searchPlaceholder")}
                  label={t("business.console.orders.searchPlaceholder")}
                />
              }
            />
            {visible.length === 0 ? (
              <ConsoleEmpty compact icon={Package} title={t("business.console.orders.noMatches")} />
            ) : (
              <ConsoleTable label={t("business.console.orders.allTitle")}>
                <thead>
                  <tr>
                    <th>{t("business.qrStudio.physical.orders.colOrder")}</th>
                    <th>{t("business.qrStudio.physical.orders.colProduct")}</th>
                    <th>{t("business.qrStudio.physical.orders.colDate")}</th>
                    <th className="ac-num">{t("business.qrStudio.physical.orders.colAmount")}</th>
                    <th>{t("business.qrStudio.physical.orders.status")}</th>
                    <th className="ac-actions">{t("business.qrStudio.physical.orders.colAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((o) => {
                    const status = physicalQrCustomerStatus(o, t);
                    const showPay = canPayOrder(o);
                    return (
                      <tr key={o.id} {...rowLink(orderHref(o.id))}>
                        <td data-primary>
                          <Link to={orderHref(o.id)} className="ac-cell-primary hover:underline">
                            #{physicalQrOrderNumber(o.id)}
                          </Link>
                        </td>
                        <td data-label={t("business.qrStudio.physical.orders.colProduct")}>
                          <div>
                            <span className="font-medium">{productLabel(o)}</span>
                            <span className="ac-cell-secondary">
                              {itemSummary(o)} · {t("business.qrStudio.physical.orders.qtyShort", { count: o.quantity })}
                            </span>
                          </div>
                        </td>
                        <td data-label={t("business.qrStudio.physical.orders.colDate")} className="ac-nowrap">
                          <div>
                            {formatBerlinDateCompact(o.placedAt, lang)}
                            <span className="ac-cell-secondary">{formatRelative(o.placedAt, lang)}</span>
                          </div>
                        </td>
                        <td data-label={t("business.qrStudio.physical.orders.colAmount")} className="ac-num font-semibold">
                          {formatPhysicalQrMoney(o.totalAmount, o.currency, lang)}
                        </td>
                        <td data-label={t("business.qrStudio.physical.orders.status")}>
                          <ConsoleStatus tone={TONE[status.tone]}>{status.title}</ConsoleStatus>
                        </td>
                        <td className="ac-actions">
                          {showPay ? (
                            <button
                              type="button"
                              className="ac-btn ac-btn--primary ac-btn--sm"
                              disabled={payingOrderId === o.id}
                              onClick={() => void payOrder(o.id)}
                            >
                              {payLabel(o)}
                            </button>
                          ) : (
                            <Link to={orderHref(o.id)} className="ac-btn ac-btn--ghost ac-btn--sm">
                              {t("business.qrStudio.physical.orders.viewOrder")}
                              <ChevronRight aria-hidden />
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </ConsoleTable>
            )}
          </ConsoleCard>
        </>
      )}
    </div>
  );
}
