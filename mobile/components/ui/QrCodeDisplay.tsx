import { StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useI18n } from "@/hooks/useI18n";
import { maskIdsInUrl } from "@/utils/format";
import { colors, radius, spacing, typography } from "@/theme";

type QrCodeDisplayProps = {
  value: string;
  title: string;
  subtitle?: string | null;
  size?: number;
  elevated?: boolean;
  hideRawUrl?: boolean;
};

export function QrCodeDisplay({
  value,
  title,
  subtitle,
  size = 220,
  elevated = false,
  hideRawUrl = true,
}: QrCodeDisplayProps) {
  const { t } = useI18n();

  if (!value) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.muted}>{t("qr.unavailable")}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, elevated ? styles.elevated : null]}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <View style={styles.qrWrap}>
        <QRCode value={value} size={size} color={colors.foreground} backgroundColor="#FFFFFF" />
      </View>
      <Text style={styles.url} numberOfLines={2}>
        {hideRawUrl ? t("qr.tipLinkHint") : maskIdsInUrl(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
    alignItems: "center",
  },
  elevated: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.xl,
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
  qrWrap: {
    padding: spacing.lg,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
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
