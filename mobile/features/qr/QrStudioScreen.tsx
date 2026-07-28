import { useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "@/components/ui/Button";
import { QrCodeDisplay } from "@/components/ui/QrCodeDisplay";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { StatusPill } from "@/components/ui/StatusPill";
import { ScreenShell, screenContentPadding, useListRefreshControl } from "@/components/ui/ScreenShell";
import { useQrStudio } from "@/hooks/useQrStudio";
import { useI18n } from "@/hooks/useI18n";
import { loadOfflineQrItems } from "@/utils/offlineQrCache";
import { friendlyErrorMessage, isPermissionError } from "@/utils/friendlyError";
import type { QrCodeItem } from "@/types/qr";
import { colors, spacing, typography } from "@/theme";

export function QrStudioScreen() {
  const { t } = useI18n();
  const [selected, setSelected] = useState<QrCodeItem | null>(null);
  const [offlineItems, setOfflineItems] = useState<QrCodeItem[]>([]);
  const { items, isLoading, isRefreshing, refresh, error } = useQrStudio();

  const typeLabels: Record<QrCodeItem["type"], string> = {
    business: t("qr.businessQr"),
    employee: t("qr.employeeQr"),
    location: t("qr.locationQr"),
    table: t("qr.tableQr"),
  };

  useEffect(() => {
    void loadOfflineQrItems().then(setOfflineItems);
  }, [items]);

  const displayItems = items.length > 0 ? items : offlineItems;
  const offline = items.length === 0 && offlineItems.length > 0;
  const refreshControl = useListRefreshControl(isRefreshing, () => void refresh());

  const handleCopy = async (url: string) => {
    await Clipboard.setStringAsync(url);
    Alert.alert(t("qr.linkCopiedTitle"), t("qr.linkCopiedBody"));
  };

  const handleShare = async (item: QrCodeItem) => {
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(item.url, { dialogTitle: `${t("qr.share")} ${item.title}` });
    } else {
      await handleCopy(item.url);
    }
  };

  const listHeader = (
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
          {isPermissionError(error) ? (
            <EmptyState
              variant="qr"
              title={t("errors.permissionTitle")}
              message={friendlyErrorMessage(error, t("errors.permissionBody"), t)}
            />
          ) : (
            <ErrorState
              message={friendlyErrorMessage(error, t("qr.loadError"), t)}
              onRetry={() => void refresh()}
            />
          )}
        </>
      ) : (
        <FlatList
          data={selected ? [] : displayItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={refreshControl}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            selected ? null : (
              <EmptyState
                variant="qr"
                title={t("qr.emptyTitle")}
                message={t("qr.emptyMessage")}
              />
            )
          }
          renderItem={({ item }) => (
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
          )}
        />
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
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
