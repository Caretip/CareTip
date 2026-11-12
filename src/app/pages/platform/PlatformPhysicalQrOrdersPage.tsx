import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight, Package, PackageCheck, PauseCircle, Printer, Truck } from "lucide-react";
import { toast } from "sonner";
import { fetchPlatformPhysicalQrOrders, type PhysicalQrAdminOrder } from "../../lib/api";
import {
  formatBerlinDateCompact,
  formatPhysicalQrMoney,
  physicalQrContextLabel,
  physicalQrFulfillmentLabel,
  physicalQrOrderNumber,
  physicalQrPaymentLabel,
} from "../../lib/physicalQrOrderUi";
import {
  ConsoleCard,
  ConsoleEmpty,
  ConsoleHeader,
  ConsoleKpi,
  ConsoleKpiGrid,
  ConsolePage,
  ConsoleSearch,
  ConsoleSegments,
  ConsoleSkeletonRows,
  ConsoleStatus,
  ConsoleTable,
  ConsoleToolbar,
  ConsoleCallout,
  useRowLink,
} from "../../components/platform/console/AdminConsole";
import { qrFulfillmentTone, qrOrderIsHeld, qrPaymentTone } from "../../components/platform/console/consoleTones";
import { formatCount, formatRelative } from "../../components/platform/console/consoleFormat";
import { PLATFORM_ADMIN_OVERVIEW_HREF, PLATFORM_BRANDING_ORDERS_BASE } from "../../components/platform/platformAdminNav";
import { toDisplayErrorMessage } from "@/app/lib/errorMessages";
import { isPhysicalQrFulfillable } from "../../lib/physicalQrOrderUi";

const FILTERS = [
  "all",
  "pending_payment",
  "paid",
  "processing",
  "printing",
  "shipped",
  "delivered",
  "cancelled",
  "payment_failed",
] as const;
type Filter = (typeof FILTERS)[number];

function summarize(orders: PhysicalQrAdminOrder[]) {
  let ready = 0;
  let held = 0;
  let printing = 0;
  let transit = 0;
  for (const o of orders) {
    if (qrOrderIsHeld(o)) held += 1;
    else if (["PAID", "PROCESSING"].includes(o.fulfillmentStatus) && isPhysicalQrFulfillable(o.paymentStatus, o.holdReleasedAt)) ready += 1;
    if (o.fulfillmentStatus === "PRINTING" && !qrOrderIsHeld(o)) printing += 1;
    if (o.fulfillmentStatus === "SHIPPED") transit += 1;
  }
  return { ready, held, printing, transit };
}

export function PlatformPhysicalQrOrdersPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [orders, setOrders] = useState<PhysicalQrAdminOrder[]>([]);
  const [allOrders, setAllOrders] = useState<PhysicalQrAdminOrder[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rowLink = useRowLink();

  async function reload(nextFilter: Filter = filter, nextQ = q) {
    const data = await fetchPlatformPhysicalQrOrders({
      filter: nextFilter === "all" ? undefined : nextFilter,
      q: nextQ.trim() || undefined,
    });
    setOrders(data.orders);
    if (nextFilter === "all" && !nextQ.trim()) setAllOrders(data.orders);
    setError(null);
  }

  useEffect(() => {
    void reload()
      .catch((err) => {
        setError(toDisplayErrorMessage(err, t("admin.physicalQr.loadError")));
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const summary = useMemo(() => (allOrders ? summarize(allOrders) : null), [allOrders]);

  const applyFilter = (id: Filter) => {
    setFilter(id);
    void reload(id, q).catch((err) => toast.error(toDisplayErrorMessage(err, t("admin.physicalQr.loadError"))));
  };

  return (
    <ConsolePage className="platform-physical-qr">
      <ConsoleHeader
        icon={Package}
        crumbs={[{ label: t("admin.workspace.eyebrow"), href: PLATFORM_ADMIN_OVERVIEW_HREF }, { label: t("admin.physicalQr.title") }]}
        title={t("admin.physicalQr.title")}
        description={t("admin.physicalQr.subtitle")}
      />

      <ConsoleKpiGrid columns={4} label={t("admin.physicalQr.title")}>
        <ConsoleKpi
          icon={Printer}
          tone={(summary?.ready ?? 0) > 0 ? "attention" : undefined}
          label={t("admin.console.overview.qrReadyToFulfil")}
          value={formatCount(summary?.ready, lang)}
          hint={t("admin.console.qr.readyHint")}
          loading={!summary && !error}
        />
        <ConsoleKpi
          icon={PauseCircle}
          tone={(summary?.held ?? 0) > 0 ? "failure" : undefined}
          label={t("admin.console.overview.qrOnHold")}
          value={formatCount(summary?.held, lang)}
          hint={t("admin.console.qr.heldHint")}
          loading={!summary && !error}
        />
        <ConsoleKpi
          icon={Printer}
          tone="info"
          label={t("admin.physicalQr.filters.printing")}
          value={formatCount(summary?.printing, lang)}
          loading={!summary && !error}
        />
        <ConsoleKpi
          icon={Truck}
          tone="success"
          label={t("admin.console.overview.qrInTransit")}
          value={formatCount(summary?.transit, lang)}
          loading={!summary && !error}
        />
      </ConsoleKpiGrid>

      <ConsoleCard flush>
        <ConsoleToolbar
          start={
            <ConsoleSegments
              label={t("admin.physicalQr.colFulfillment")}
              options={FILTERS.map((id) => ({ value: id, label: t(`admin.physicalQr.filters.${id}`) }))}
              value={filter}
              onChange={applyFilter}
            />
          }
          end={
            <form
              role="search"
              className="w-full lg:w-auto"
              onSubmit={(e) => {
                e.preventDefault();
                void reload(filter, q).catch((err) => toast.error(toDisplayErrorMessage(err, t("admin.physicalQr.loadError"))));
              }}
            >
              <ConsoleSearch
                value={q}
                onChange={setQ}
                placeholder={t("admin.physicalQr.searchPlaceholder")}
                label={t("admin.physicalQr.searchPlaceholder")}
                wide
              />
            </form>
          }
        />

        {loading ? (
          <div role="status" aria-busy="true">
            <ConsoleSkeletonRows rows={6} />
          </div>
        ) : error ? (
          <div className="p-5">
            <ConsoleCallout tone="failure" title={t("admin.physicalQr.loadError")}>
              {error}
            </ConsoleCallout>
          </div>
        ) : orders.length === 0 ? (
          <ConsoleEmpty icon={PackageCheck} title={t("admin.physicalQr.empty")} />
        ) : (
          <ConsoleTable label={t("admin.physicalQr.title")}>
            <thead>
              <tr>
                <th>{t("admin.physicalQr.colOrder")}</th>
                <th>{t("admin.physicalQr.business")}</th>
                <th>{t("admin.physicalQr.colItems")}</th>
                <th className="ac-num">{t("admin.console.qr.colTotal")}</th>
                <th>{t("admin.physicalQr.colPayment")}</th>
                <th>{t("admin.physicalQr.colFulfillment")}</th>
                <th>{t("admin.physicalQr.colPlaced")}</th>
                <th className="ac-actions">
                  <span className="sr-only">{t("admin.physicalQr.colAction")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const href = `${PLATFORM_BRANDING_ORDERS_BASE}/${order.id}`;
                const items =
                  order.itemCount > 1
                    ? t("admin.physicalQr.itemCount", { count: order.itemCount, defaultValue: "{{count}} QR items" })
                    : physicalQrContextLabel(order.qrContextType, t);
                const held = qrOrderIsHeld(order);
                return (
                  <tr key={order.id} {...rowLink(href)}>
                    <td data-primary>
                      <Link to={href} className="ac-cell-primary hover:underline">
                        #{physicalQrOrderNumber(order.id)}
                      </Link>
                      <span className="ac-cell-secondary">{order.productName ?? "—"}</span>
                    </td>
                    <td data-label={t("admin.physicalQr.business")} className="min-w-0 break-words">{order.businessName}</td>
                    <td data-label={t("admin.physicalQr.colItems")} className="ac-nowrap">
                      {items} · ×{order.quantity}
                    </td>
                    <td data-label={t("admin.console.qr.colTotal")} className="ac-num font-semibold">
                      {formatPhysicalQrMoney(order.totalAmount, order.currency, lang)}
                    </td>
                    <td data-label={t("admin.physicalQr.colPayment")}>
                      <ConsoleStatus tone={qrPaymentTone(order.paymentStatus)}>
                        {physicalQrPaymentLabel(order.paymentStatus, t, { totalAmount: order.totalAmount })}
                      </ConsoleStatus>
                    </td>
                    <td data-label={t("admin.physicalQr.colFulfillment")}>
                      <span className="inline-flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
                        <ConsoleStatus tone={held ? "neutral" : qrFulfillmentTone(order.fulfillmentStatus)}>
                          {physicalQrFulfillmentLabel(order.fulfillmentStatus, t, { totalAmount: order.totalAmount })}
                        </ConsoleStatus>
                        {held ? <ConsoleStatus tone="failure">{t("admin.console.overview.qrOnHold")}</ConsoleStatus> : null}
                      </span>
                    </td>
                    <td data-label={t("admin.physicalQr.colPlaced")} className="ac-nowrap">
                      <span title={formatBerlinDateCompact(order.placedAt, lang)}>{formatRelative(order.placedAt, lang)}</span>
                      <span className="ac-cell-secondary">{formatBerlinDateCompact(order.placedAt, lang)}</span>
                    </td>
                    <td className="ac-actions">
                      <Link to={href} className="ac-btn ac-btn--ghost ac-btn--sm" aria-label={`${t("admin.physicalQr.openOrder")} #${physicalQrOrderNumber(order.id)}`}>
                        {t("admin.physicalQr.openOrder")}
                        <ChevronRight aria-hidden />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </ConsoleTable>
        )}
      </ConsoleCard>
    </ConsolePage>
  );
}
