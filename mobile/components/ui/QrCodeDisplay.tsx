import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BrandedQrImage, type BrandedQrViewerMode } from "@/components/qr/BrandedQrImage";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { shadows, spacing, surface, typography } from "@/theme";

type QrCodeDisplayProps = {
  value: string;
  title: string;
  subtitle?: string | null;
  size?: number;
  elevated?: boolean;
  hideRawUrl?: boolean;
  /** Web renderer mode — employee My QR vs manager QR Studio inventory. */
  mode: BrandedQrViewerMode;
  /** Increment to revalidate branded QR from API after pull-to-refresh. */
  reloadKey?: number;
};

/**
 * Branded QR card — displays the server-rendered PNG (shared pipeline with web).
 */
export function QrCodeDisplay({
  value,
  title,
  subtitle,
  size = 220,
  elevated = false,
  hideRawUrl = true,
  mode,
  reloadKey,
}: QrCodeDisplayProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!value) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.muted}>{t("qr.unavailable")}</Text>
      </View>
    );
  }

  const minHeight = Math.max(size + 140, 380);

  return (
    <View style={[styles.wrap, elevated ? styles.elevated : null]}>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <BrandedQrImage targetUrl={value} mode={mode} minHeight={minHeight} reloadKey={reloadKey} />
      <Text style={styles.url} numberOfLines={2}>
        {hideRawUrl ? t("qr.tipLinkHint") : value}
      </Text>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrap: {
      gap: spacing.md,
      alignItems: "center",
      width: "100%",
    },
    elevated: {
      backgroundColor: colors.card,
      borderRadius: surface.cardRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.xl,
      ...shadows.sm,
    },
    title: {
      ...typography.cardTitle,
      color: colors.foreground,
      textAlign: "center",
    },
    subtitle: {
      ...typography.caption,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    url: {
      ...typography.caption,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    muted: {
      ...typography.body,
      color: colors.mutedForeground,
    },
  });
}
