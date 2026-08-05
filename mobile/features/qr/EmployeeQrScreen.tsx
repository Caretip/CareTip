import { useEffect, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { QrCodeDisplay } from "@/components/ui/QrCodeDisplay";
import { RemoteAvatar } from "@/components/ui/RemoteAvatar";
import { Screen } from "@/components/ui/Screen";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { fetchEmployeeProfile } from "@/services/api/employeeService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { resolveEmployeeQrUrl } from "@/utils/appPublicUrl";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { showSuccessToast } from "@/store/toastStore";
import { loadEmployeeQrCache, saveEmployeeQrCache } from "@/utils/offlineQrCache";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";

export function EmployeeQrScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const [cached, setCached] = useState<Awaited<ReturnType<typeof loadEmployeeQrCache>>>(null);
  const [qrReloadKey, setQrReloadKey] = useState(0);

  const {
    data: profile,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: keys.employeeMe,
    queryFn: fetchEmployeeProfile,
    enabled: Boolean(userId),
    staleTime: queryStaleTimes.profile,
  });

  useEffect(() => {
    setCached(null);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadEmployeeQrCache(userId).then((value) => {
      if (!cancelled) setCached(value);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const liveUrl =
    profile != null
      ? resolveEmployeeQrUrl({
          employeeId: profile.id,
          businessSlug: profile.businessSlug,
          employeeSlug: profile.slug,
        })
      : "";

  // Never render another account's offline QR while the current profile is still loading.
  const url = liveUrl || (!isLoading ? cached?.url ?? "" : "");

  useEffect(() => {
    if (!userId || !profile || !liveUrl) return;
    void saveEmployeeQrCache(userId, {
      url: liveUrl,
      name: profile.name,
      businessName: profile.businessName ?? t("businessDashboard.venueFallback"),
      cachedAt: new Date().toISOString(),
    }).then(() => void loadEmployeeQrCache(userId).then(setCached));
  }, [userId, profile, liveUrl, t]);

  const displayName = profile?.name ?? (!isLoading ? cached?.name : undefined) ?? t("qr.myQrTitle");
  const offline = !profile && !isLoading && Boolean(cached?.url);

  const handleCopy = async () => {
    if (!url) return;
    await Clipboard.setStringAsync(url);
    showSuccessToast(t("success.linkCopied"));
  };

  const handleShare = async () => {
    if (!url) return;
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(url, { dialogTitle: `${t("qr.share")} ${displayName}` });
    } else {
      await handleCopy();
    }
  };

  return (
    <Screen
      refreshing={isRefetching}
      onRefresh={() => {
        setQrReloadKey((k) => k + 1);
        void refetch();
      }}
    >
      <View style={styles.hero}>
        <RemoteAvatar
          displayName={displayName}
          uri={profile?.avatar}
          size={56}
          tone="brand"
          cacheBust={dataUpdatedAt}
        />
        <Text style={styles.eyebrow}>{t("qr.myQrEyebrow")}</Text>
        <Text style={styles.title}>{t("qr.myQrTitle")}</Text>
        <Text style={styles.subtitle}>{t("qr.myQrSubtitle")}</Text>
        {offline ? (
          <Text style={styles.offlineNote}>{t("common.offline")}</Text>
        ) : null}
      </View>

      {isLoading && !url ? (
        <View style={styles.loading}>
          <Skeleton height={280} rounded="2xl" />
        </View>
      ) : isError && !url ? (
        <ErrorState
          message={friendlyErrorMessage(error, t("qr.loadError"), t)}
          onRetry={() => void refetch()}
        />
      ) : url ? (
        <>
          <QrCodeDisplay
            value={url}
            title={displayName}
            subtitle={t("qr.employeeQr")}
            size={240}
            mode="employee"
            reloadKey={qrReloadKey}
          />
          <View style={styles.actions}>
            <Button label={t("qr.copyLink")} onPress={() => void handleCopy()} />
            <Button
              label={t("qr.share")}
              variant="secondary"
              onPress={() => void handleShare()}
            />
          </View>
        </>
      ) : (
        <View style={styles.loading}>
          <Skeleton height={280} rounded="2xl" />
        </View>
      )}
    </Screen>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    hero: {
      gap: spacing.sm,
      paddingBottom: spacing.lg,
    },
    eyebrow: {
      ...typography.overline,
      color: colors.primary,
    },
    title: {
      ...typography.title,
      color: colors.foreground,
    },
    subtitle: {
      ...typography.body,
      color: colors.mutedForeground,
    },
    offlineNote: {
      ...typography.caption,
      color: colors.warning,
      fontWeight: "600",
    },
    loading: {
      gap: spacing.md,
    },
    actions: {
      gap: spacing.md,
    },
  });
}
