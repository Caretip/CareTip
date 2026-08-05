import { useCallback, useEffect, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "@/components/ui/Button";
import { QrCodeDisplay } from "@/components/ui/QrCodeDisplay";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  ScreenShell,
  screenContentPadding,
  useListRefreshControl,
  useScreenContentPadding,
} from "@/components/ui/ScreenShell";
import { useQrStudio } from "@/hooks/useQrStudio";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { loadOfflineQrItems } from "@/utils/offlineQrCache";
import { resolveQrStudioDisplayItems } from "@/utils/offlineQrTenantIsolation";
import { AccessErrorState } from "@/components/ui/AccessErrorState";
import { showSuccessToast } from "@/store/toastStore";
import type { QrCodeItem } from "@/types/qr";
import { LIST_PERF_COMPACT } from "@/constants/listPerf";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";

export function QrStudioScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const contentPad = useScreenContentPadding();
  const listContentStyle = useMemo(
    () => [styles.list, { paddingBottom: contentPad.paddingBottom }],
    [contentPad.paddingBottom, styles.list],
  );
  const [selected, setSelected] = useState<QrCodeItem | null>(null);
  const [offlineItems, setOfflineItems] = useState<QrCodeItem[]>([]);
  const { userId, items, isLoading, isRefreshing, refresh, error } = useQrStudio();

  const typeLabels: Record<QrCodeItem["type"], string> = useMemo(
    () => ({
      business: t("qr.businessQr"),
      employee: t("qr.employeeQr"),
      location: t("qr.locationQr"),
      table: t("qr.tableQr"),
    }),
    [t],
  );

  // Drop any prior-account offline paint immediately on identity change.
  useEffect(() => {
    setSelected(null);
    setOfflineItems([]);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadOfflineQrItems(userId).then((cached) => {
      if (!cancelled) setOfflineItems(cached);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, items]);

  const displayItems = resolveQrStudioDisplayItems({
    liveItems: items,
    offlineItems,
    isLoading,
  });
  const offline = !isLoading && items.length === 0 && offlineItems.length > 0;

  useEffect(() => {
    if (!selected) return;
    if (items.length === 0) {
      if (isLoading) setSelected(null);
      return;
    }
    const stillOwned = items.some(
      (row) => row.id === selected.id && row.url === selected.url,
    );
    if (!stillOwned) setSelected(null);
  }, [items, isLoading, selected]);

  const refreshControl = useListRefreshControl(isRefreshing, () => void refresh());

  const handleCopy = useCallback(async (url: string) => {
    await Clipboard.setStringAsync(url);
    showSuccessToast(t("success.linkCopied"));
  }, [t]);

  const handleShare = useCallback(async (item: QrCodeItem) => {
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(item.url, { dialogTitle: `${t("qr.share")} ${item.title}` });
    } else {
      await handleCopy(item.url);
    }
  }, [handleCopy, t]);

  const listHeader = useMemo(
    () => (
      <>
        <View style={styles.header}>
          <Text style={styles.title}>{t("qr.studioTitle")}</Text>
          {offline ? <Text style={styles.offlineNote}>{t("common.offline")}</Text> : null}
        </View>
        {selected ? (
          <View style={styles.detail}>
            <QrCodeDisplay
              value={selected.url}
              title={selected.title}
              subtitle={typeLabels[selected.type]}
              size={240}
              elevated={false}
              mode="manager"
            />
            <View style={styles.actions}>
              <Button
                label={t("qr.copyLink")}
                variant="secondary"
                onPress={() => void handleCopy(selected.url)}
              />
              <Button label={t("qr.share")} onPress={() => void handleShare(selected)} />
              <Button label={t("qr.backToList")} variant="ghost" onPress={() => setSelected(null)} />
            </View>
          </View>
        ) : null}
      </>
    ),
    [handleCopy, handleShare, offline, selected, styles, t, typeLabels],
  );

  const keyExtractor = useCallback((item: QrCodeItem) => item.id, []);

  const renderItem = useCallback(
    ({ item }: { item: QrCodeItem }) => (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        accessibilityRole="button"
        onPress={() => setSelected(item)}
      >
        <View style={styles.rowBody}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.subtitle ? <Text style={styles.cardSubtitle}>{item.subtitle}</Text> : null}
        </View>
        <StatusPill label={typeLabels[item.type]} tone="brand" />
      </Pressable>
    ),
    [styles, typeLabels],
  );

  return (
    <ScreenShell>
      {isLoading && displayItems.length === 0 ? (
        <>
          {listHeader}
          <View style={styles.listPad}>
            <SkeletonListRows count={4} />
          </View>
        </>
      ) : error && displayItems.length === 0 ? (
        <>
          {listHeader}
          <AccessErrorState
            error={error}
            fallbackMessage={t("qr.loadError")}
            onRetry={() => void refresh()}
            permissionVariant="qr"
          />
        </>
      ) : (
        <FlatList
          data={selected ? [] : displayItems}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={listContentStyle}
          refreshControl={refreshControl}
          ListHeaderComponent={listHeader}
          {...LIST_PERF_COMPACT}
          ListEmptyComponent={
            selected ? null : (
              <EmptyState
                variant="qr"
                title={t("qr.emptyTitle")}
                message={t("qr.emptyMessage")}
              />
            )
          }
        />
      )}
    </ScreenShell>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    header: {
      gap: spacing.xs,
      marginBottom: spacing.md,
    },
    title: {
      ...typography.title,
      color: colors.foreground,
    },
    offlineNote: {
      ...typography.caption,
      color: colors.warning,
      fontWeight: "600",
    },
    listPad: {
      paddingHorizontal: spacing.xl,
    },
    list: {
      ...screenContentPadding,
      flexGrow: 1,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      paddingVertical: spacing.lg,
      minHeight: 48,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowBody: {
      gap: spacing.xs,
      flex: 1,
    },
    pressed: {
      opacity: 0.92,
    },
    cardTitle: {
      ...typography.cardTitle,
      color: colors.foreground,
    },
    cardSubtitle: {
      ...typography.caption,
      color: colors.mutedForeground,
    },
    detail: {
      gap: spacing.lg,
      marginBottom: spacing.xl,
      paddingVertical: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    actions: {
      gap: spacing.md,
    },
  });
}
