import { Link } from "react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Eye, MapPin, Printer, Users, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { getEmployees, fetchPhysicalQrOrders, type PhysicalQrCustomerOrder } from "@/app/lib/api";
import { fetchVenueCatalog } from "@/app/lib/businessVenueCatalog";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { PhysicalQrOrderCard } from "@/app/components/business/physical-branding/PhysicalQrOrderCard";
import { QrStudioOverviewSkeleton } from "@/app/components/business/qr-studio/QrStudioLoadingSkeletons";
import { QR_STUDIO_BASE } from "@/app/components/business/businessDashboardNav";
import { qrStudioPrintPath, qrStudioViewPath, type QrStudioCategory } from "@/app/lib/qrStudioNav";
type OverviewCounts = {
  employees: number;
  tables: number;
  locations: number;
};

export function QrStudioOverviewPage() {
  const { t } = useTranslation();
  const { user } = useRequireAuth();
  const [counts, setCounts] = useState<OverviewCounts>({ employees: 0, tables: 0, locations: 0 });
  const [orders, setOrders] = useState<PhysicalQrCustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [staff, venue, history] = await Promise.all([
          user?.businessId ? getEmployees(user.businessId).catch(() => [] as Awaited<ReturnType<typeof getEmployees>>) : Promise.resolve([]),
          fetchVenueCatalog().catch(() => ({ locations: [], tables: [] })),
          fetchPhysicalQrOrders().catch(() => ({ orders: [] as PhysicalQrCustomerOrder[] })),
        ]);
        if (cancelled) return;
        setCounts({
          employees: Array.isArray(staff) ? staff.length : 0,
          tables: venue.tables?.length ?? 0,
          locations: venue.locations?.length ?? 0,
        });
        setOrders((history.orders ?? []).slice(0, 3));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.businessId]);

  const qrRows: Array<{
    category: QrStudioCategory;
    icon: typeof Building2;
    title: string;
    desc: string;
    meta: string;
  }> = [
    {
      category: "business",
      icon: Building2,
      title: t("business.qrStudio.overview.businessTitle"),
      desc: t("business.qrStudio.overview.businessDesc"),
      meta: t("business.qrStudio.overview.businessMeta"),
    },
    {
      category: "employees",
      icon: Users,
      title: t("business.qrStudio.nav.employees"),
      desc: t("business.qrStudio.overview.employeesDesc"),
      meta: t("business.qrStudio.overview.countActive", { count: counts.employees }),
    },
    {
      category: "tables",
      icon: LayoutGrid,
      title: t("business.qrStudio.nav.tables"),
      desc: t("business.qrStudio.overview.tablesDesc"),
      meta: t("business.qrStudio.overview.countItems", { count: counts.tables }),
    },
    {
      category: "locations",
      icon: MapPin,
      title: t("business.qrStudio.nav.locations"),
      desc: t("business.qrStudio.overview.locationsDesc"),
      meta: t("business.qrStudio.overview.countItems", { count: counts.locations }),
    },
  ];
  return (
    <div className="qr-studio-overview space-y-8 max-lg:space-y-6">
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {t("business.qrStudio.overview.intro")}
      </p>

      {loading ? (
        <QrStudioOverviewSkeleton />
      ) : (
        <section aria-labelledby="qr-studio-codes-heading">
          <h2 id="qr-studio-codes-heading" className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("business.qrStudio.overview.codesSection")}
          </h2>
          <ul className="divide-y divide-border/80 border-y border-border/80">
            {qrRows.map((row) => (
              <li key={row.category} className="py-3.5 max-lg:py-3">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <row.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{row.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{row.desc}</p>
                    <p className="mt-1 text-xs font-medium text-foreground/80">{row.meta}</p>
                    <div className="mt-2.5 inline-flex flex-wrap gap-2">
                      <Link
                        to={qrStudioViewPath(row.category)}
                        className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-border/80 px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                        {t("business.qrStudio.viewPrint.view")}
                      </Link>
                      <Link
                        to={qrStudioPrintPath(row.category)}
                        className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                      >
                        <Printer className="h-3.5 w-3.5" aria-hidden />
                        {t("business.qrStudio.viewPrint.print")}
                      </Link>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-border/70 bg-muted/20 p-4 max-lg:border-0 max-lg:bg-transparent max-lg:p-0 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{t("business.qrStudio.overview.printSectionTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("business.qrStudio.overview.printSectionDesc")}</p>
          </div>
          <Link
            to={`${QR_STUDIO_BASE}/print`}
            className={cn(businessUi.btnPrimary, "inline-flex w-full items-center justify-center gap-2 sm:w-auto")}
          >
            <Printer className="h-4 w-4" aria-hidden />
            {t("business.qrStudio.overview.startOrder")}
          </Link>
        </div>
      </section>

      {loading ? null : orders.length > 0 ? (
        <section aria-labelledby="qr-studio-recent-orders">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="qr-studio-recent-orders" className="text-base font-semibold text-foreground">
              {t("business.qrStudio.overview.recentOrders")}
            </h2>
            <Link to={`${QR_STUDIO_BASE}/orders`} className="text-sm font-medium text-primary hover:underline">
              {t("business.qrStudio.overview.viewAllOrders")}
            </Link>
          </div>
          <div className="divide-y divide-border/80 border-y border-border/80">
            {orders.map((order) => (
              <PhysicalQrOrderCard key={order.id} order={order} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
