import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { useBrandedQrImage } from "@/hooks/useBrandedQrImage";
import { useI18n } from "@/hooks/useI18n";
import { BrandedQrFetchError } from "@/services/api/brandedQrService";
import { normalizeApiError } from "@/types/api";
import type { BrandedQrViewerMode } from "@/types/qr";
import { colors, spacing, typography } from "@/theme";

export type { BrandedQrViewerMode };

type BrandedQrImageProps = {
  targetUrl: string;
  mode: BrandedQrViewerMode;
  minHeight?: number;
  reloadKey?: number;
};

function resolveBrandedQrMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof BrandedQrFetchError) {
    if (error.status === 403) return t("qr.brandedPermissionError");
    if (error.status === 404 || error.code === "BRANDED_QR_NOT_FOUND") {
      return t("qr.brandedNotFound");
    }
    if (error.status === 503) return t("qr.brandedUnavailable");
    if (error.status === 500) return t("qr.brandedLoadError");
    return t("qr.brandedLoadError");
  }

  const normalized = normalizeApiError(error);
  if (normalized.isNetworkError || normalized.isTimeout) {
    return t("qr.brandedNetworkError");
  }
  if (normalized.status === 403) return t("qr.brandedPermissionError");
  if (normalized.status === 404) return t("qr.brandedNotFound");
  if (normalized.status === 500 || normalized.status === 503) return t("qr.brandedLoadError");
  return t("qr.brandedLoadError");
}

/**
 * Displays the server-rendered branded QR PNG — same asset as web Preview / download.
 */
export function BrandedQrImage({ targetUrl, mode, minHeight = 400, reloadKey = 0 }: BrandedQrImageProps) {
  const { t } = useI18n();
  const { data, isLoading, isError, error, refetch, isFetching } = useBrandedQrImage({
    mode,
    targetUrl,
    reloadKey,
    enabled: Boolean(targetUrl.trim()),
  });

  if (!targetUrl.trim()) {
    return (
      <View style={[styles.fallback, { minHeight }]}>
        <Text style={styles.fallbackText}>{t("qr.unavailable")}</Text>
      </View>
    );
  }

  if (isLoading && !data) {
    return (
      <View style={[styles.frame, { minHeight }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError || !data?.dataUri) {
    return (
      <View style={[styles.fallback, { minHeight }]}>
        <Text style={styles.fallbackText}>{resolveBrandedQrMessage(error, t)}</Text>
        <Text style={styles.hintText} onPress={() => void refetch()}>
          {t("common.tryAgain")}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.frame, { minHeight }]}>
      {data.fallback === "standard" ? (
        <Text style={styles.fallbackBanner}>{t("qr.usingStandardQr")}</Text>
      ) : null}
      <Image
        source={{ uri: data.dataUri }}
        style={styles.image}
        resizeMode="contain"
        accessibilityLabel={t("qr.myQrTitle")}
      />
      {isFetching && !isLoading ? (
        <View style={styles.refreshOverlay}>
          <ActivityIndicator color={colors.primary} size="small" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: 12,
    backgroundColor: "transparent",
    gap: spacing.sm,
  },
  image: {
    width: "100%",
    height: undefined,
    aspectRatio: 0.72,
    maxHeight: 560,
  },
  fallbackBanner: {
    ...typography.caption,
    color: colors.mutedForeground,
    textAlign: "center",
  },
  refreshOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "flex-end",
    justifyContent: "flex-start",
    padding: spacing.sm,
  },
  fallback: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    borderRadius: 12,
    backgroundColor: colors.muted,
    gap: spacing.sm,
  },
  fallbackText: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
  },
  hintText: {
    ...typography.caption,
    color: colors.primary,
    textAlign: "center",
    fontWeight: "600",
  },
});
