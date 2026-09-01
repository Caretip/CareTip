import { Link } from "react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Building2, LayoutGrid, MapPin, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";
import { Button } from "@/components/ui/button";
import { getEmployees, fetchPhysicalQrOrders, type PhysicalQrCustomerOrder } from "@/app/lib/api";
import { fetchVenueCatalog } from "@/app/lib/businessVenueCatalog";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { PhysicalQrStatusBadge } from "@/app/components/business/physical-branding/PhysicalQrStatusBadge";
import { QrStudioOverviewSkeleton } from "@/app/components/business/qr-studio/QrStudioLoadingSkeletons";
import { QR_STUDIO_BASE } from "@/app/components/business/businessDashboardNav";
import { qrStudioPrintPath, qrStudioViewPath, type QrStudioCategory } from "@/app/lib/qrStudioNav";
import {
  formatBerlinDateTime,
  formatPhysicalQrMoney,
  physicalQrContextLabel,
  physicalQrCustomerStatus,
  physicalQrOrderNumber,
  physicalQrShippingFromUnknown,
} from "@/app/lib/physicalQrOrderUi";

const focusLink =
  "inline-flex items-center gap-1 rounded-sm text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2";
const quietLink =
  "inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2";

type OverviewCounts = {
  employees: number;
  tables: number;
  locations: number;
};

function QrCornerAccent({ className }: { className?: string }) {
  return (
    <span className={cn("pointer-events-none absolute text-primary/25", className)} aria-hidden>
      <span className="absolute left-0 top-0 h-3 w-3 border-l border-t border-current" />
      <span className="absolute right-0 top-0 h-3 w-3 border-r border-t border-current" />
      <span className="absolute bottom-0 left-0 h-3 w-3 border-b border-l border-current" />
      <span className="absolute bottom-0 right-0 h-3 w-3 border-b border-r border-current" />
    </span>
  );
}

export function QrStudioOverviewPage() {
  const { t, i18n } = useTranslation();
  const { user } = useRequireAuth();
  const [counts, setCounts] = useState<OverviewCounts>({ employees: 0, tables: 0, locations: 0 });
  const [orders, setOrders] = useState<PhysicalQrCustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [staff, venue, history] = await Promise.all([
          user?.businessId
            ? getEmployees(user.businessId).catch(() => [] as Awaited<ReturnType<typeof getEmployees>>)
            : Promise.resolve([]),
          fetchVenueCatalog().catch(() => ({ locations: [], tables: [] })),
          fetchPhysicalQrOrders().catch(() => ({ orders: [] as PhysicalQrCustomerOrder[] })),
        ]);
        if (cancelled) return;
        setCounts({
          employees: Array.isArray(staff) ? staff.length : 0,
          tables: venue.tables?.length ?? 0,
          locations: venue.locations?.length ?? 0,
        });
        setOrders((history.orders ?? []).slice(0, 2));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.businessId]);

  const printHref = `${QR_STUDIO_BASE}/print`;
  const ordersHref = `${QR_STUDIO_BASE}/orders`;

  const workspaceItems: Array<{
    category: QrStudioCategory;
    icon: typeof Building2;
    title: string;
    meta: string;
  }> = [
    {
      category: "business",
      icon: Building2,
      title: t("business.qrStudio.nav.business"),
      meta: t("business.qrStudio.overview.businessMeta"),
    },
    {
      category: "employees",
      icon: Users,
      title: t("business.qrStudio.nav.employees"),
      meta: loading ? "\u00a0" : t("business.qrStudio.overview.countTeam", { count: counts.employees }),
    },
    {
      category: "tables",
      icon: LayoutGrid,
      title: t("business.qrStudio.nav.tables"),
      meta: loading ? "\u00a0" : t("business.qrStudio.overview.countTables", { count: counts.tables }),
    },
    {
      category: "locations",
      icon: MapPin,
      title: t("business.qrStudio.nav.locations"),
      meta: loading ? "\u00a0" : t("business.qrStudio.overview.countLocations", { count: counts.locations }),
    },
  ];

  return (
    <div className="qr-studio-overview space-y-12 max-lg:space-y-10">
      <section aria-labelledby="qr-studio-overview-intro" className="relative max-w-2xl p-3 sm:p-4">
        <QrCornerAccent className="inset-0 hidden sm:block" />
        <h2
          id="qr-studio-overview-intro"
          className={cn(dashboardWorkspaceUi.pageTitle, "max-w-xl text-balance tracking-tight text-foreground")}
        >
          {t("business.qrStudio.overview.headline")}
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("business.qrStudio.overview.intro")}
        </p>
        <div className="mt-6">
          <Button asChild className={cn(businessUi.btnPrimary, "w-full sm:w-auto")}>
            <Link to={printHref}>
              {t("business.qrStudio.overview.startOrder")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="qr-studio-business-qr-heading" className="relative border-y border-border/80 px-1 py-7 sm:px-2">
        <QrCornerAccent className="inset-0 hidden sm:block" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t("business.qrStudio.overview.yourBusinessQr")}
        </p>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 id="qr-studio-business-qr-heading" className="text-lg font-semibold tracking-tight text-foreground">
              {t("business.qrStudio.overview.businessTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("business.qrStudio.overview.businessDesc")}</p>
            <p className="mt-0.5 text-sm text-foreground/75">{t("business.qrStudio.overview.businessMeta")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link to={qrStudioViewPath("business")} className={focusLink}>
              {t("business.qrStudio.overview.viewQr")}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <Link to={qrStudioPrintPath("business")} className={quietLink}>
              {t("business.qrStudio.overview.printAction")}
            </Link>
          </div>
        </div>
      </section>

      <nav aria-labelledby="qr-studio-workspace-heading">
        <h2
          id="qr-studio-workspace-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
        >
          {t("business.qrStudio.overview.workspaceTitle")}
        </h2>
        <ul className="mt-2 grid grid-cols-1 border-y border-border/70 sm:grid-cols-2 lg:grid-cols-4">
          {workspaceItems.map((item) => (
            <li
              key={item.category}
              className="border-border/70 border-b last:border-b-0 sm:[&:nth-last-child(-n+2)]:max-lg:border-b-0 sm:odd:max-lg:border-r lg:border-b-0 lg:border-r lg:last:border-r-0"
            >
              <Link
                to={qrStudioViewPath(item.category)}
                className="group flex items-start justify-between gap-3 px-0 py-3.5 transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 sm:px-3 lg:px-4"
              >
                <span className="flex min-w-0 items-start gap-2.5">
                  <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{item.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.meta}</span>
                  </span>
                </span>
                <ArrowRight
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section
        aria-labelledby="qr-studio-my-orders"
        className="border-y border-primary/15 border-l-2 border-l-primary/45 bg-primary/[0.035] px-4 py-6 sm:px-5"
      >
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="qr-studio-my-orders"
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/85"
          >
            {t("business.qrStudio.nav.orders")}
          </h2>
          <Link to={ordersHref} className={quietLink}>
            {t("business.qrStudio.overview.viewAllOrders")}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        <p className="mb-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {t("business.qrStudio.orders.subtitle")}
        </p>
        {loading ? (
          <QrStudioOverviewSkeleton />
        ) : orders.length > 0 ? (
          <ul className="divide-y divide-border/70 border-t border-border/70">
            {orders.map((order) => {
              const status = physicalQrCustomerStatus(order, t);
              const canPay =
                order.canPay ??
                ((order.paymentStatus === "PENDING" && order.fulfillmentStatus === "PENDING_PAYMENT") ||
                  (order.paymentStatus === "FAILED" && order.fulfillmentStatus === "PAYMENT_FAILED"));
              const failed = order.paymentStatus === "FAILED" || order.fulfillmentStatus === "PAYMENT_FAILED";
              const itemSummary =
                order.itemCount > 1
                  ? t("business.qrStudio.physical.orders.itemCount", {
                      count: order.itemCount,
                      defaultValue: "{{count}} QR items",
                    })
                  : physicalQrContextLabel(order.qrContextType, t);
              const detailHref = `${QR_STUDIO_BASE}/orders/${order.id}`;
              const shippingCity = physicalQrShippingFromUnknown(order.shippingSnapshot)?.city;
              return (
                <li key={order.id} className="py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium tracking-wide text-foreground">
                        #{physicalQrOrderNumber(order.id)}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {itemSummary}
                        {" · "}
                        {t("business.qrStudio.physical.orders.qtyShort", { count: order.quantity })}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {formatBerlinDateTime(order.placedAt, i18n.language)}
                        {shippingCity ? ` · ${shippingCity}` : ""}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground sm:text-right">
                      {formatPhysicalQrMoney(order.totalAmount, order.currency, i18n.language)}
                    </p>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <PhysicalQrStatusBadge tone={status.tone} label={status.title} />
                    {canPay ? (
                      <Button asChild className={cn(businessUi.btnPrimary, "shrink-0")}>
                        <Link to={detailHref}>
                          {failed
                            ? t("business.qrStudio.physical.orders.tryPaymentAgain")
                            : t("business.qrStudio.physical.payNow")}
                          <ArrowRight className="h-4 w-4" aria-hidden />
                        </Link>
                      </Button>
                    ) : (
                      <Link to={detailHref} className={focusLink}>
                        {t("business.qrStudio.physical.orders.viewOrder")}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="border-t border-border/70 py-6">
            <p className="text-sm font-medium text-foreground">{t("business.qrStudio.overview.ordersEmptyTitle")}</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {t("business.qrStudio.overview.ordersEmptyDesc")}
            </p>
            <Link to={printHref} className={cn(focusLink, "mt-4 inline-flex")}>
              {t("business.qrStudio.overview.startOrder")}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        )}
      </section>

      <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">{t("business.qrStudio.overview.tip")}</p>
    </div>
  );
}
