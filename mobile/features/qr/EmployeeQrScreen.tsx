import { useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { QrCodeDisplay } from "@/components/ui/QrCodeDisplay";
import { Screen } from "@/components/ui/Screen";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useI18n } from "@/hooks/useI18n";
import { fetchEmployeeProfile } from "@/services/api/employeeService";
import { queryKeys, queryStaleTimes } from "@/services/api/queryClient";
import { resolveEmployeeQrUrl } from "@/utils/appPublicUrl";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { showSuccessToast } from "@/store/toastStore";
import { loadEmployeeQrCache, saveEmployeeQrCache } from "@/utils/offlineQrCache";
import { colors, spacing, typography } from "@/theme";

export function EmployeeQrScreen() {
  const { t } = useI18n();
  const [cached, setCached] = useState<Awaited<ReturnType<typeof loadEmployeeQrCache>>>(null);
  const [qrReloadKey, setQrReloadKey] = useState(0);

  const { data: profile, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.employeeMe,
    queryFn: fetchEmployeeProfile,
    staleTime: queryStaleTimes.profile,
  });

  useEffect(() => {
    void loadEmployeeQrCache().then(setCached);
  }, []);

  const url =
    profile != null
      ? resolveEmployeeQrUrl({
          employeeId: profile.id,
          businessSlug: profile.businessSlug,
          employeeSlug: profile.slug,
        })
      : (cached?.url ?? "");

  useEffect(() => {
    if (!profile || !url) return;
    void saveEmployeeQrCache({
      url,
      name: profile.name,
      businessName: profile.businessName ?? t("businessDashboard.venueFallback"),
      cachedAt: new Date().toISOString(),
    }).then(() => void loadEmployeeQrCache().then(setCached));
  }, [profile, url, t]);

  const displayName = profile?.name ?? cached?.name ?? t("qr.myQrTitle");
  const offline = !profile && Boolean(cached?.url);

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
        <Text style={styles.eyebrow}>{t("qr.myQrEyebrow")}</Text>
        <Text style={styles.title}>{t("qr.myQrTitle")}</Text>
        <Text style={styles.subtitle}>{t("qr.myQrSubtitle")}</Text>
        {offline ? (
          <Text style={styles.offlineNote}>{t("common.offline")}</Text>
        ) : null}
      </View>

      {isLoading && !cached?.url ? (
        <View style={styles.loading}>
          <Skeleton height={280} rounded="2xl" />
        </View>
      ) : isError && !url ? (
        <ErrorState
          message={friendlyErrorMessage(error, t("qr.loadError"), t)}
          onRetry={() => void refetch()}
        />
      ) : (
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
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
