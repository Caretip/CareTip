import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquareHeart } from "lucide-react";
import { toast } from "sonner";
import {
  fetchPlatformProductReviewById,
  fetchPlatformProductReviews,
  fetchPlatformProductReviewSummary,
  patchPlatformProductReviewStatus,
  type PlatformProductFeedbackAdminItem,
  type PlatformProductFeedbackAdminStatus,
  type PlatformProductFeedbackSummary,
} from "@/app/lib/api";
import { toUserFriendlyMessage } from "@/app/lib/errorMessages";
import { logClientError } from "@/app/lib/clientLog";
import {
  PlatformPage,
  PlatformPageHeader,
  PlatformAdminEmptyBlock,
  PlatformAdminFilterBar,
  PlatformAdminMetricStrip,
  PlatformResponsiveData,
} from "@/app/components/platform/PlatformPageChrome";
import { PlatformAdminTableSkeleton } from "@/app/components/dashboard/DashboardSectionLoading";
import { ProductFeedbackStatusBadge } from "@/app/components/product-feedback/ProductFeedbackStatusBadge";
import { ProductFeedbackAdminDetailSheet } from "@/app/components/product-feedback/ProductFeedbackAdminDetailSheet";
import { formatProductFeedbackDate } from "@/app/components/product-feedback/productFeedbackPresentation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { platformUi } from "@/app/components/platform/platformDashboardUi";
import { cn } from "@/lib/utils";

const ADMIN_STATUSES: PlatformProductFeedbackAdminStatus[] = ["new", "read", "archived"];

export function PlatformProductReviewsPage() {
  const { t, i18n } = useTranslation();
  const [summary, setSummary] = useState<PlatformProductFeedbackSummary | null>(null);
  const [items, setItems] = useState<PlatformProductFeedbackAdminItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<PlatformProductFeedbackAdminStatus | "all">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "MANAGER" | "EMPLOYEE">("all");
  const [ratingFilter, setRatingFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlatformProductFeedbackAdminItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, listRes] = await Promise.all([
        fetchPlatformProductReviewSummary(),
        fetchPlatformProductReviews({
          take: 50,
          skip: 0,
          adminStatus: statusFilter === "all" ? undefined : statusFilter,
          submitterRole: roleFilter === "all" ? undefined : roleFilter,
          rating: ratingFilter === "all" ? undefined : Number(ratingFilter),
        }),
      ]);
      setSummary(sumRes.summary);
      setItems(listRes.items);
      setTotal(listRes.total);
    } catch (err) {
      logClientError("PlatformProductReviewsPage.load", err);
      toast.error(toUserFriendlyMessage(err));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [ratingFilter, roleFilter, statusFilter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const res = await fetchPlatformProductReviewById(id);
      setDetail(res.feedback);
    } catch (err) {
      logClientError("PlatformProductReviewsPage.detail", err);
      toast.error(toUserFriendlyMessage(err));
      setSelectedId(null);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const onStatusChange = async (status: PlatformProductFeedbackAdminStatus) => {
    if (!detail) return;
    setStatusUpdating(true);
    try {
      const res = await patchPlatformProductReviewStatus(detail.id, status);
      setDetail(res.feedback);
      setItems((prev) => prev.map((row) => (row.id === res.feedback.id ? res.feedback : row)));
      toast.success(t("productReview.admin.statusUpdated"));
      void loadList();
    } catch (err) {
      logClientError("PlatformProductReviewsPage.patchStatus", err);
      toast.error(toUserFriendlyMessage(err));
    } finally {
      setStatusUpdating(false);
    }
  };

  const newCount = useMemo(() => items.filter((i) => i.adminStatus === "new").length, [items]);

  const kpiCards = [
    {
      label: t("productReview.admin.kpi.total"),
      value: summary?.totalCount ?? "—",
    },
    {
      label: t("productReview.admin.kpi.average"),
      value: summary?.averageRating != null ? summary.averageRating.toFixed(1) : "—",
    },
    {
      label: t("productReview.admin.kpi.recent30d"),
      value: summary?.recentCount30d ?? "—",
    },
    {
      label: t("productReview.admin.kpi.needsAttention"),
      value: loading ? "…" : newCount,
    },
  ];

  const empty = !loading && items.length === 0 && total === 0;

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={MessageSquareHeart}
        title={t("productReview.admin.title")}
        subtitle={t("productReview.admin.subtitle")}
      />

      <PlatformAdminMetricStrip aria-label={t("productReview.admin.kpi.aria")}>
        {kpiCards.map((card) => (
          <div key={card.label} className="product-feedback-admin-kpi min-w-[10rem] flex-1">
            <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{card.value}</p>
          </div>
        ))}
      </PlatformAdminMetricStrip>

      <PlatformAdminFilterBar className="mb-4 mt-6">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as PlatformProductFeedbackAdminStatus | "all")}
        >
          <SelectTrigger className="w-full sm:w-[160px]" aria-label={t("productReview.admin.filters.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("productReview.admin.filters.allStatuses")}</SelectItem>
            {ADMIN_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{t(`productReview.admin.status.${s}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
          <SelectTrigger className="w-full sm:w-[160px]" aria-label={t("productReview.admin.filters.role")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("productReview.admin.filters.allRoles")}</SelectItem>
            <SelectItem value="MANAGER">{t("productReview.admin.role.MANAGER")}</SelectItem>
            <SelectItem value="EMPLOYEE">{t("productReview.admin.role.EMPLOYEE")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={ratingFilter} onValueChange={setRatingFilter}>
          <SelectTrigger className="w-full sm:w-[140px]" aria-label={t("productReview.admin.filters.rating")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("productReview.admin.filters.allRatings")}</SelectItem>
            {[5, 4, 3, 2, 1].map((r) => (
              <SelectItem key={r} value={String(r)}>{r} ★</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PlatformAdminFilterBar>

      {empty && !loading ? (
        <PlatformAdminEmptyBlock
          title={t("productReview.admin.empty.title")}
          description={t("productReview.admin.empty.description")}
        />
      ) : (
        <PlatformResponsiveData
          desktop={
            <div className={cn(platformUi.tableWrap, "block")}>
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">{t("productReview.admin.table.user")}</th>
                    <th className="pb-3 pr-4 font-medium">{t("productReview.admin.table.role")}</th>
                    <th className="pb-3 pr-4 font-medium">{t("productReview.admin.table.rating")}</th>
                    <th className="pb-3 pr-4 font-medium">{t("productReview.admin.table.preview")}</th>
                    <th className="pb-3 pr-4 font-medium">{t("productReview.admin.table.status")}</th>
                    <th className="pb-3 font-medium">{t("productReview.admin.table.date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && items.length === 0 ? (
                    <PlatformAdminTableSkeleton rows={6} cols={6} />
                  ) : null}
                  {items.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/30"
                      onClick={() => void openDetail(row.id)}
                    >
                      <td className="py-3 pr-4 font-medium">{row.userEmail ?? "—"}</td>
                      <td className="py-3 pr-4">{t(`productReview.admin.role.${row.submitterRole}`)}</td>
                      <td className="py-3 pr-4 tabular-nums">{row.rating}</td>
                      <td className="max-w-[240px] truncate py-3 pr-4 text-muted-foreground">
                        {row.commentExcerpt ?? row.comment ?? "—"}
                      </td>
                      <td className="py-3 pr-4">
                        <ProductFeedbackStatusBadge status={row.adminStatus} />
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {formatProductFeedbackDate(row.createdAt, i18n.language)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
          mobile={
            loading && items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("productReview.admin.loading")}</p>
            ) : (
            <ul className="space-y-3">
              {items.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="w-full rounded-xl border border-border/80 bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/20"
                    onClick={() => void openDetail(row.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm">{row.userEmail ?? "—"}</span>
                      <ProductFeedbackStatusBadge status={row.adminStatus} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t(`productReview.admin.role.${row.submitterRole}`)} · {row.rating}/5 ·{" "}
                      {formatProductFeedbackDate(row.createdAt, i18n.language)}
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm text-foreground/85">
                      {row.commentExcerpt ?? row.comment ?? "—"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            )
          }
        />
      )}

      <ProductFeedbackAdminDetailSheet
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setDetail(null);
          }
        }}
        feedback={detail}
        loading={detailLoading}
        statusUpdating={statusUpdating}
        onStatusChange={onStatusChange}
      />
    </PlatformPage>
  );
}
