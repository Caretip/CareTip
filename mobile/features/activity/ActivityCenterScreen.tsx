import { useCallback, useMemo, memo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ActivityCard } from "@/components/ui/ListCards";
import { DetailScreenHeader } from "@/components/ui/DetailScreenHeader";
import { PeriodToggle } from "@/components/ui/PeriodToggle";
import {
  ScreenShell,
  screenContentPadding,
  useListRefreshControl,
  useScreenContentPadding,
} from "@/components/ui/ScreenShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { useActivityCenterFeed } from "@/hooks/useActivityCenterFeed";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import type {
  ActivityCenterFilter,
  ActivityEventSource,
  BusinessActivityFeedItem,
} from "@/types/activity";
import { getActivityAmount, getActivitySubtitle, getActivityTitle } from "@/utils/activityLabels";
import { formatActivityVenueTimeParts } from "@/utils/businessVenueTime";
import { formatTimeAgo } from "@/utils/formatTimeAgo";
import { formatEur } from "@/utils/format";
import { LIST_PERF } from "@/constants/listPerf";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";

const SOURCE_TONE: Record<
  ActivityEventSource,
  "brand" | "success" | "info" | "warning" | "neutral" | "danger"
> = {
  TIPS: "success",
  QR: "brand",
  PAYMENTS: "info",
  GOALS: "warning",
  STAFF: "neutral",
  SYSTEM: "neutral",
};

function sourceLabelKey(source: ActivityEventSource): string {
  return `activity.source.${source.toLowerCase()}` as const;
}

function dayGroupKey(iso: string, venueTimezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: venueTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

const ActivityRow = memo(function ActivityRow({
  item,
  venueTimezone,
  hideRelative,
  isLast,
  sourceLabel,
}: {
  item: BusinessActivityFeedItem;
  venueTimezone: string;
  hideRelative: boolean;
  isLast: boolean;
  sourceLabel: string;
}) {
  const amount = getActivityAmount(item);
  const parts = formatActivityVenueTimeParts(item.occurredAt, venueTimezone);
  const subtitle = getActivitySubtitle(item);
  const tone = SOURCE_TONE[item.source] ?? "neutral";

  return (
    <ActivityCard
      title={getActivityTitle(item)}
      subtitle={subtitle}
      meta={`${parts.timeText}${!hideRelative ? ` · ${formatTimeAgo(item.occurredAt)}` : ""}`}
      amount={amount != null ? formatEur(amount) : null}
      badgeLabel={sourceLabel}
      badgeTone={tone}
      isLast={isLast}
    />
  );
});

export function ActivityCenterScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const contentPad = useScreenContentPadding();
  const listContentStyle = useMemo(
    () => [styles.list, { paddingBottom: contentPad.paddingBottom }],
    [contentPad.paddingBottom, styles.list],
  );
  const { user } = useAuth();
  const {
    filter,
    setFilter,
    items,
    venueTimezone,
    isInitialLoading,
    isRefreshing,
    isLoadingOlder,
    hasMore,
    refresh,
    loadOlder,
    error,
  } = useActivityCenterFeed({ enabled: true, businessId: user?.businessId });

  const filterOptions: Array<{ value: ActivityCenterFilter; label: string }> = [
    { value: "all", label: t("activity.filterAll") },
    { value: "today", label: t("activity.today") },
    { value: "TIPS", label: t("tabs.tips") },
  ];

  const sections = useMemo(() => {
    const map = new Map<string, BusinessActivityFeedItem[]>();
    for (const item of items) {
      const key = dayGroupKey(item.occurredAt, venueTimezone);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries()).flatMap(([key, group]) => {
      const sample = group[0];
      if (!sample) return [];
      const parts = formatActivityVenueTimeParts(sample.occurredAt, venueTimezone);
      const label: string =
        parts.dayLabel === "today"
          ? t("activity.today")
          : parts.dayLabel === "yesterday"
            ? t("activity.yesterday")
            : parts.dateText ?? key;
      return [{ key, label, items: group }];
    });
  }, [items, venueTimezone, t]);

  type ListEntry =
    | { kind: "header"; id: string; label: string }
    | { kind: "item"; id: string; item: BusinessActivityFeedItem; isLast: boolean };

  const flatData = useMemo(() => {
    const rows: ListEntry[] = [];
    for (const section of sections) {
      rows.push({ kind: "header", id: `h-${section.key}`, label: section.label });
      section.items.forEach((item, index) => {
        rows.push({
          kind: "item",
          id: item.id,
          item,
          isLast: index === section.items.length - 1,
        });
      });
    }
    return rows;
  }, [sections]);

  const renderItem = useCallback(
    ({ item }: { item: ListEntry }) => {
      if (item.kind === "header") {
        return <Text style={styles.dayHeader}>{item.label}</Text>;
      }
      return (
        <ActivityRow
          item={item.item}
          venueTimezone={venueTimezone}
          hideRelative={filter === "today"}
          isLast={item.isLast}
          sourceLabel={t(sourceLabelKey(item.item.source))}
        />
      );
    },
    [venueTimezone, filter, t, styles.dayHeader],
  );

  const refreshControl = useListRefreshControl(isRefreshing, () => void refresh());

  const keyExtractor = useCallback((row: ListEntry) => row.id, []);

  const handleEndReached = useCallback(() => {
    if (hasMore && !isLoadingOlder) void loadOlder();
  }, [hasMore, isLoadingOlder, loadOlder]);

  return (
    <ScreenShell>
      <View style={styles.header}>
        <DetailScreenHeader
          title={t("activity.title")}
          fallbackHref="/(app)/business/menu"
        />
      </View>

      <View style={styles.filters}>
        <PeriodToggle value={filter} options={filterOptions} onChange={setFilter} />
      </View>

      {isInitialLoading ? (
        <View style={styles.listPad}>
          <SkeletonListRows count={5} />
        </View>
      ) : error && items.length === 0 ? (
        <ErrorState
          message={error || t("activity.loadError")}
          onRetry={() => void refresh()}
        />
      ) : (
        <FlatList
          data={flatData}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={listContentStyle}
          refreshControl={refreshControl}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          {...LIST_PERF}
          ListEmptyComponent={
            <EmptyState
              variant="activity"
              title={filter === "today" ? t("activity.emptyToday") : t("activity.empty")}
              message={t("activity.emptyMessage")}
            />
          }
          ListFooterComponent={
            isLoadingOlder ? (
              <ActivityIndicator color={colors.primary} style={styles.footerLoader} />
            ) : hasMore ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("activity.loadOlder")}
                onPress={() => void loadOlder()}
                style={styles.loadMore}
              >
                <Text style={styles.loadMoreText}>{t("activity.loadOlder")}</Text>
              </Pressable>
            ) : items.length > 0 ? (
              <Text style={styles.endOfList}>{t("activity.endOfList")}</Text>
            ) : null
          }
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
      gap: spacing.xs,
    },
    eyebrow: {
      ...typography.overline,
      color: colors.primary,
    },
    title: {
      ...typography.title,
      color: colors.foreground,
    },
    headerSub: {
      ...typography.body,
      color: colors.mutedForeground,
    },
    filters: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.md,
    },
    listPad: {
      ...screenContentPadding,
    },
    list: {
      ...screenContentPadding,
      flexGrow: 1,
      paddingTop: spacing.xs,
    },
    dayHeader: {
      ...typography.overline,
      color: colors.mutedForeground,
      marginTop: spacing.md,
      marginBottom: spacing.md,
    },
    footerLoader: {
      marginVertical: spacing.lg,
    },
    loadMore: {
      alignItems: "center",
      paddingVertical: spacing.lg,
      minHeight: 48,
      justifyContent: "center",
    },
    loadMoreText: {
      ...typography.button,
      color: colors.primary,
    },
    endOfList: {
      ...typography.caption,
      color: colors.mutedForeground,
      textAlign: "center",
      paddingVertical: spacing.lg,
    },
  });
}
