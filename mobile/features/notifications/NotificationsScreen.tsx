import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Href } from "expo-router";
import { SearchField } from "@/components/ui/SearchField";
import { Button } from "@/components/ui/Button";
import {
  ScreenShell,
  screenContentPadding,
  useListRefreshControl,
  useScreenContentPadding,
} from "@/components/ui/ScreenShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { NotificationCard } from "@/components/ui/ListCards";
import { DetailScreenHeader } from "@/components/ui/DetailScreenHeader";
import { useNotificationsFeed } from "@/hooks/useNotifications";
import { useAuth } from "@/hooks/useAuth";
import { useEmployeeAvatarLookup } from "@/hooks/useEmployeeAvatarLookup";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { formatTimeAgo } from "@/utils/formatTimeAgo";
import { formatNotificationType } from "@/utils/labels";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import {
  getNotificationActor,
  notificationHasPersonActor,
} from "@/utils/notificationMedia";
import { LIST_PERF } from "@/constants/listPerf";
import type { ColorPalette } from "@/theme/colors";
import { spacing, surface, typography } from "@/theme";

function dayBucket(
  iso: string,
  t: (key: string) => string,
): { key: string; label: string } {
  const date = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  const startMsg = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (startMsg.getTime() === startToday.getTime()) {
    return { key: "today", label: t("activity.today") };
  }
  if (startMsg.getTime() === startYesterday.getTime()) {
    return { key: "yesterday", label: t("activity.yesterday") };
  }
  const key = iso.slice(0, 10);
  return {
    key,
    label: new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date),
  };
}

export function NotificationsScreen({
  menuFallbackHref = "/(app)/business/menu",
}: {
  menuFallbackHref?: Href;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const contentPad = useScreenContentPadding();
  const listContentStyle = useMemo(
    () => [styles.list, { paddingBottom: contentPad.paddingBottom }],
    [contentPad.paddingBottom, styles.list],
  );
  const [search, setSearch] = useState("");
  const avatarLookup = useEmployeeAvatarLookup(user?.role === "MANAGER");
  const {
    items,
    isLoading,
    isRefetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isError,
    error,
    markRead,
    markAllRead,
  } = useNotificationsFeed(search);

  const refreshControl = useListRefreshControl(isRefetching, () => void refetch());

  type Row =
    | { kind: "header"; id: string; label: string }
    | { kind: "item"; id: string; item: (typeof items)[number] };

  const rows = useMemo(() => {
    const out: Row[] = [];
    let lastKey = "";
    for (const item of items) {
      const bucket = dayBucket(item.createdAt, t);
      if (bucket.key !== lastKey) {
        out.push({ kind: "header", id: `h-${bucket.key}`, label: bucket.label });
        lastKey = bucket.key;
      }
      out.push({ kind: "item", id: item.id, item });
    }
    return out;
  }, [items, t]);

  const renderRow = useCallback(
    ({ item: row }: { item: Row }) => {
      if (row.kind === "header") {
        return <Text style={styles.dayHeader}>{row.label}</Text>;
      }
      const item = row.item;
      const actor = getNotificationActor(item.metadata);
      const hasActor = notificationHasPersonActor(actor);
      const avatarUri = hasActor
        ? actor.employeeId && user?.employeeId && actor.employeeId === user.employeeId
          ? user.avatar
          : avatarLookup.resolve({
              employeeId: actor.employeeId,
              name: actor.displayName,
            }) ?? (actor.employeeId === user?.employeeId ? user?.avatar : undefined)
        : undefined;
      return (
        <NotificationCard
          title={item.title}
          message={item.message}
          meta={`${formatNotificationType(item.type)} · ${formatTimeAgo(item.createdAt)}`}
          unread={!item.read}
          inset
          actorName={hasActor ? actor.displayName ?? actor.employeeId : null}
          avatarUri={avatarUri}
          onPress={() => {
            if (!item.read) void markRead.mutateAsync(item.id);
          }}
        />
      );
    },
    [avatarLookup, markRead, styles.dayHeader, user?.avatar, user?.employeeId],
  );

  const keyExtractor = useCallback((row: Row) => row.id, []);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <ScreenShell>
      <View style={styles.header}>
        <DetailScreenHeader
          title={t("notifications.title")}
          fallbackHref={menuFallbackHref}
        />
        <Button
          label={t("notifications.markAllRead")}
          variant="outline"
          loading={markAllRead.isPending}
          disabled={markAllRead.isPending}
          onPress={() => void markAllRead.mutateAsync()}
        />
      </View>

      <View style={styles.search}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t("notifications.search")}
          accessibilityLabel={t("notifications.search")}
        />
      </View>

      {isLoading && items.length === 0 ? (
        <View style={styles.listPad}>
          <SkeletonListRows count={5} />
        </View>
      ) : isError && items.length === 0 ? (
        <ErrorState
          message={friendlyErrorMessage(error, t("notifications.loadError"), t)}
          onRetry={() => void refetch()}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderRow}
          contentContainerStyle={listContentStyle}
          refreshControl={refreshControl}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <EmptyState
              variant="notifications"
              title={t("notifications.emptyTitle")}
              message={t("notifications.emptyMessage")}
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator color={colors.primary} style={styles.footerLoader} />
            ) : null
          }
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
      gap: spacing.lg,
    },
    search: {
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.md,
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
    dayHeader: {
      ...typography.overline,
      color: colors.mutedForeground,
      marginTop: spacing.sm,
      marginBottom: spacing.md,
    },
    footerLoader: {
      marginVertical: spacing.lg,
    },
  });
}
