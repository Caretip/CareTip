import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Filter, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dashboardWorkspaceUi } from "../dashboard/dashboardWorkspaceUi";
import { platformUi } from "./platformDashboardUi";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/app/components/ui/sheet";
import type {
  PlatformBusinessDatePreset,
  PlatformBusinessSort,
  PlatformBusinessStatusFilter,
  PlatformBusinessTipsFilter,
} from "../../lib/api";
import type { BusinessVerificationFilterState } from "../../hooks/useBusinessVerificationFilters";

const filterSelectTrigger =
  "min-h-[44px] w-full rounded-lg border border-border bg-card text-sm text-foreground shadow-sm focus:border-accent/40 focus:ring-accent/25";

/** Single responsive row from lg up; labels never overlap (DE/EN). */
const filterGridInline =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4 min-[1440px]:grid-cols-[repeat(4,minmax(0,1fr))] min-[1440px]:gap-4";

const filterLabelClass =
  "block min-h-[2.5rem] text-pretty text-xs font-medium leading-snug text-muted-foreground line-clamp-2 sm:min-h-[2.25rem]";

type BusinessVerificationFiltersProps = {
  workflow?: "kyc" | "onboarding" | "all";
  filters: BusinessVerificationFilterState;
  onChange: (patch: Partial<BusinessVerificationFilterState>) => void;
  onClearAll: () => void;
  onRemoveChip: (key: keyof BusinessVerificationFilterState) => void;
  hasActiveFilters: boolean;
  searchValue: string;
  onSearchChange: (value: string) => void;
};

function FilterFields({
  workflow = "kyc",
  filters,
  onChange,
  layout,
}: {
  workflow?: "kyc" | "onboarding" | "all";
  filters: BusinessVerificationFilterState;
  onChange: (patch: Partial<BusinessVerificationFilterState>) => void;
  layout: "inline" | "stacked";
}) {
  const { t } = useTranslation();
  const stacked = layout === "stacked";
  const statusOptions: PlatformBusinessStatusFilter[] =
    workflow === "onboarding" || workflow === "all"
      ? ["all", "draft", "submitted", "approved", "rejected", "suspended", "inactive"]
      : ["all", "verified", "pending_review", "awaiting_upload", "not_started", "sla_breach", "rejected", "suspended", "inactive"];

  const statusLabelKey =
    workflow === "all"
      ? "admin.allBusinessesPage.filters.statusLabel"
      : "admin.businessVerificationPage.filters.statusLabel";

  return (
    <div className={cn(stacked ? "flex flex-col gap-3" : filterGridInline)}>
      <label className="block min-w-0 space-y-1.5">
        <span className={filterLabelClass}>
          {t("admin.businessVerificationPage.filters.dateLabel")}
        </span>
        <Select
          value={filters.date}
          onValueChange={(value) =>
            onChange({
              date: value as PlatformBusinessDatePreset,
              ...(value !== "custom" ? { dateFrom: "", dateTo: "" } : {}),
            })
          }
        >
          <SelectTrigger className={filterSelectTrigger} size="default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              ["all", "today", "last_7", "last_30", "this_month", "last_month", "custom"] as const
            ).map((key) => (
              <SelectItem key={key} value={key}>
                {t(`admin.businessVerificationPage.filters.date.${key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {filters.date === "custom" ? (
        <div className={cn("grid gap-2", stacked ? "grid-cols-1" : "sm:col-span-2 sm:grid-cols-2")}>
          <label className="block space-y-1.5">
            <span className={filterLabelClass}>
              {t("admin.businessVerificationPage.filters.dateFrom")}
            </span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => onChange({ dateFrom: e.target.value })}
              className={platformUi.searchInput.replace("pl-10", "px-3")}
            />
          </label>
          <label className="block space-y-1.5">
            <span className={filterLabelClass}>
              {t("admin.businessVerificationPage.filters.dateTo")}
            </span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => onChange({ dateTo: e.target.value })}
              className={platformUi.searchInput.replace("pl-10", "px-3")}
            />
          </label>
        </div>
      ) : null}

      <label className="block min-w-0 space-y-1.5">
        <span className={filterLabelClass}>
          {t(statusLabelKey)}
        </span>
        <Select
          value={filters.status}
          onValueChange={(value) => onChange({ status: value as PlatformBusinessStatusFilter })}
        >
          <SelectTrigger className={filterSelectTrigger} size="default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((key) => (
              <SelectItem key={key} value={key}>
                {t(`admin.businessVerificationPage.filters.status.${key}`, {
                  defaultValue: t(`admin.onboardingVerificationPage.filters.status.${key}`, { defaultValue: key }),
                })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="block min-w-0 space-y-1.5">
        <span className={filterLabelClass}>
          {t("admin.businessVerificationPage.filters.tipsLabel")}
        </span>
        <Select
          value={filters.tips}
          onValueChange={(value) => onChange({ tips: value as PlatformBusinessTipsFilter })}
        >
          <SelectTrigger className={filterSelectTrigger} size="default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              ["all", "zero", "1_500", "501_5000", "5001_plus", "highest", "lowest"] as const
            ).map((key) => (
              <SelectItem key={key} value={key}>
                {t(`admin.businessVerificationPage.filters.tips.${key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="block min-w-0 space-y-1.5">
        <span className={filterLabelClass}>
          {t("admin.businessVerificationPage.filters.sortLabel")}
        </span>
        <Select
          value={filters.sort}
          onValueChange={(value) => onChange({ sort: value as PlatformBusinessSort })}
        >
          <SelectTrigger className={filterSelectTrigger} size="default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              ["newest", "oldest", "tips_high", "tips_low", "name_asc", "name_desc"] as const
            ).map((key) => (
              <SelectItem key={key} value={key}>
                {t(`admin.businessVerificationPage.filters.sort.${key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}

function ActiveFilterChips({
  workflow = "kyc",
  filters,
  onRemoveChip,
}: {
  workflow?: "kyc" | "onboarding" | "all";
  filters: BusinessVerificationFilterState;
  onRemoveChip: (key: keyof BusinessVerificationFilterState) => void;
}) {
  const { t } = useTranslation();
  const statusRoot =
    workflow === "onboarding" || workflow === "all"
      ? "admin.onboardingVerificationPage.filters.status"
      : "admin.businessVerificationPage.filters.status";

  const statusLabel = (key: string) =>
    t(`${statusRoot}.${key}`, {
      defaultValue: t(`admin.businessVerificationPage.filters.status.${key}`, { defaultValue: key }),
    });

  const chips: Array<{ key: keyof BusinessVerificationFilterState; label: string }> = [];

  if (filters.q.trim()) {
    chips.push({
      key: "q",
      label: t("admin.businessVerificationPage.filters.chips.search", { q: filters.q.trim() }),
    });
  }
  if (filters.status !== "all") {
    chips.push({
      key: "status",
      label: statusLabel(filters.status),
    });
  }
  if (filters.date !== "all") {
    if (filters.date === "custom" && (filters.dateFrom || filters.dateTo)) {
      chips.push({
        key: "date",
        label: t("admin.businessVerificationPage.filters.chips.customDate", {
          from: filters.dateFrom || "…",
          to: filters.dateTo || "…",
        }),
      });
    } else {
      chips.push({
        key: "date",
        label: t(`admin.businessVerificationPage.filters.date.${filters.date}`),
      });
    }
  }
  if (filters.tips !== "all") {
    chips.push({
      key: "tips",
      label: t(`admin.businessVerificationPage.filters.tips.${filters.tips}`),
    });
  }
  if (filters.sort !== "newest") {
    chips.push({
      key: "sort",
      label: t(`admin.businessVerificationPage.filters.sort.${filters.sort}`),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onRemoveChip(chip.key)}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
        >
          <span>{chip.label}</span>
          <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="sr-only">{t("admin.businessVerificationPage.filters.removeChip")}</span>
        </button>
      ))}
    </div>
  );
}

export function BusinessVerificationFilters({
  workflow = "kyc",
  filters,
  onChange,
  onClearAll,
  onRemoveChip,
  hasActiveFilters,
  searchValue,
  onSearchChange,
}: BusinessVerificationFiltersProps) {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const searchPlaceholder =
    workflow === "all"
      ? t("admin.allBusinessesPage.searchPlaceholder")
      : t("admin.businessVerificationPage.searchPlaceholder");
  const searchAria =
    workflow === "all"
      ? t("admin.allBusinessesPage.searchAria")
      : t("admin.businessVerificationPage.searchAria");

  return (
    <div className="platform-verification-filters mb-6 space-y-4">
      <div className={cn(platformUi.searchWrap, "w-full max-w-xl")}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          autoComplete="off"
          aria-label={searchAria}
          className={platformUi.searchInput}
        />
      </div>

      <div className="hidden flex-col gap-3 lg:flex">
        <FilterFields workflow={workflow} filters={filters} onChange={onChange} layout="inline" />
        {hasActiveFilters ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClearAll}
              className={cn(dashboardWorkspaceUi.btnSecondary, "min-h-[40px] px-4 text-xs")}
            >
              {t("admin.businessVerificationPage.filters.clearAll")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 lg:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className={cn(
                  dashboardWorkspaceUi.btnSecondary,
                  "inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 px-4 text-sm",
                )}
              >
                <Filter className="h-4 w-4" aria-hidden />
                {t("admin.businessVerificationPage.filters.openDrawer")}
                {hasActiveFilters ? (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    •
                  </span>
                ) : null}
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl border-border bg-card">
              <SheetHeader>
                <SheetTitle>{t("admin.businessVerificationPage.filters.drawerTitle")}</SheetTitle>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <FilterFields
                  workflow={workflow}
                  filters={filters}
                  onChange={(patch) => onChange(patch)}
                  layout="stacked"
                />
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClearAll();
                      setMobileOpen(false);
                    }}
                    className={cn(dashboardWorkspaceUi.btnSecondary, "w-full min-h-[44px]")}
                  >
                    {t("admin.businessVerificationPage.filters.clearAll")}
                  </button>
                ) : null}
              </div>
            </SheetContent>
          </Sheet>
      </div>

      {hasActiveFilters ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ActiveFilterChips workflow={workflow} filters={filters} onRemoveChip={onRemoveChip} />
          <button
            type="button"
            onClick={onClearAll}
            className={cn(
              dashboardWorkspaceUi.btnGhost,
              "hidden min-h-[36px] shrink-0 px-3 text-xs sm:inline-flex lg:hidden",
            )}
          >
            {t("admin.businessVerificationPage.filters.clearAll")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export { BusinessVerificationFilters as PlatformBusinessListFilters };