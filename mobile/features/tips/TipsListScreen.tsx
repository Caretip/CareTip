import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SearchField } from "@/components/ui/SearchField";
import { PeriodToggle } from "@/components/ui/PeriodToggle";
import { ScreenShell, screenContentPadding, useListRefreshControl } from "@/components/ui/ScreenShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { TipCard } from "@/components/ui/ListCards";
import { DetailScreenHeader } from "@/components/ui/DetailScreenHeader";
import { useBusinessTipsList, useEmployeeTipsList } from "@/hooks/useTipsList";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { formatEur } from "@/utils/format";
import { formatTipStatus } from "@/utils/labels";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { TipActivityRow, TipStatus } from "@/types/tips";
import { LIST_PERF } from "@/constants/listPerf";
import type { ColorPalette } from "@/theme/colors";
import { spacing, surface } from "@/theme";

type TipsListScreenProps = {
  role: "business" | "employee";
  basePath: "/(app)/business/tips" | "/(app)/employee/tips";
};

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "success") return "success";
  if (status === "pending") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function formatTipDate(iso: string, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function TipsListScreen({ role, basePath }: TipsListScreenProps) {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<"today" | "week" | "month">("month");
  const [status, setStatus] = useState<"all" | TipStatus>("all");

  const params = useMemo(
    () => ({
      q: search,
      range,
      ...(status !== "all" ? { status } : {}),
    }),
    [search, range, status],
  );

  const businessQuery = useBusinessTipsList(params, { enabled: role === "business" });
  const employeeQuery = useEmployeeTipsList(params, { enabled: role === "employee" });
  const query = role === "business" ? businessQuery : employeeQuery;

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data?.pages],
  );
  const total = query.data?.pages[0]?.total ?? 0;
  const timezone = query.data?.pages[0]?.timezone;
  const refreshControl = useListRefreshControl(query.isRefetching, () => void query.refetch());

  const rangeOptions = useMemo(
    () => [
      { value: "today" as const, label: t("period.today") },
      { value: "week" as const, label: t("period.week") },
      { value: "month" as const, label: t("period.month") },
    ],
    [t],
  );

  const statusOptions = useMemo(
    () => [
      { value: "all" as const, label: t("activity.filterAll") },
      {
        value: "success" as const,
        label: role === "business" ? t("status.success") : t("status.paid"),
      },
      { value: "pending" as const, label: t("status.pending") },
      { value: "failed" as const, label: t("status.failed") },
    ],
    [role, t],
  );

  const openDetail = useCallback(
    (tip: TipActivityRow) => {
      router.push({
        pathname: `${basePath}/[id]` as never,
        params: { id: tip.id },
      });
    },
    [basePath, router],
  );

  const renderItem = useCallback(
    ({ item }: { item: TipActivityRow }) => (
      <TipCard
        inset
        amount={formatEur(item.amount)}
        statusLabel={formatTipStatus(item.status, role)}
        statusTone={statusTone(item.status)}
        staffName={item.staffName ?? t("tips.staff")}
        meta={formatTipDate(item.createdAt, timezone)}
        location={item.locationName}
        onPress={() => openDetail(item)}
      />
    ),
    [openDetail, role, t, timezone],
  );

  const keyExtractor = useCallback((item: TipActivityRow) => item.id, []);

  const handleEndReached = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  const listEmpty = useMemo(
    () => (
      <EmptyState
        variant="tips"
        title={t("tips.emptyTitle")}
        message={t("tips.emptyMessage")}
      />
    ),
    [t],
  );

  const listFooter = useMemo(
    () =>
      query.isFetchingNextPage ? (
        <ActivityIndicator color={colors.primary} style={styles.footerLoader} />
      ) : null,
    [colors.primary, query.isFetchingNextPage, styles.footerLoader],
  );

  const menuFallbackHref =
    role === "business" ? "/(app)/business/menu" : "/(app)/employee/menu";

  return (
    <ScreenShell>
      <View style={styles.header}>
        <DetailScreenHeader
          title={role === "business" ? t("tips.businessTitle") : t("tips.employeeTitle")}
          subtitle={t("tips.transactions", { count: total })}
          fallbackHref={menuFallbackHref}
        />
      </View>

      <View style={styles.filters}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={
            role === "business" ? t("tips.searchBusiness") : t("tips.searchEmployee")
          }
          accessibilityLabel={t("common.search")}
        />
        <PeriodToggle value={range} options={rangeOptions} onChange={setRange} />
        <PeriodToggle value={status} options={statusOptions} onChange={setStatus} />
      </View>

      {query.isLoading ? (
        <View style={styles.listPad}>
          <SkeletonListRows count={5} />
        </View>
      ) : query.isError ? (
        <ErrorState
          message={friendlyErrorMessage(query.error, t("tips.loadError"), t)}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={refreshControl}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={listEmpty}
          ListFooterComponent={listFooter}
          {...LIST_PERF}
        />
      )}
    </ScreenShell>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    header: {
      ...screenContentPadding,
      paddingBottom: spacing.md,
      paddingTop: spacing.md,
    },
    filters: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.md,
      gap: spacing.md,
    },
    listPad: {
      ...screenContentPadding,
    },
    list: {
      ...screenContentPadding,
      flexGrow: 1,
      backgroundColor: colors.card,
      borderRadius: surface.groupRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
    },
    footerLoader: {
      marginVertical: spacing.lg,
    },
  });
}
