import { StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { InfoScreenShell } from "@/components/info/InfoScreenShell";
import { ABOUT_CONTENT } from "@/constants/infoContent";
import { BrandMark } from "@/components/brand/BrandMark";
import { useI18n } from "@/hooks/useI18n";
import { colors, radius, spacing, typography } from "@/theme";

export function AboutScreen() {
  const { t } = useI18n();
  const version = Constants.expoConfig?.version ?? "1.0.0";
  const build =
    Constants.nativeBuildVersion ??
    String(Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber ?? "1");

  return (
    <InfoScreenShell title={t("info.aboutTitle")}>
      <View style={styles.hero}>
        <BrandMark height={36} />
        <Text style={styles.heroTitle}>{ABOUT_CONTENT.storyTitle}</Text>
        <Text style={styles.body}>{ABOUT_CONTENT.storyBody}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardEyebrow}>{ABOUT_CONTENT.missionTitle}</Text>
        <Text style={styles.body}>{ABOUT_CONTENT.missionBody}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardEyebrow}>{ABOUT_CONTENT.visionTitle}</Text>
        <Text style={styles.body}>{ABOUT_CONTENT.visionBody}</Text>
      </View>

      <View style={styles.metaCard}>
        <MetaRow label={t("info.version")} value={version} />
        <MetaRow label={t("info.build")} value={build} />
        <Text style={styles.copyright}>{ABOUT_CONTENT.copyright}</Text>
      </View>
    </InfoScreenShell>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  heroTitle: {
    ...typography.h1,
    color: colors.foreground,
    fontSize: 26,
  },
  body: {
    ...typography.body,
    color: colors.mutedForeground,
    lineHeight: 23,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardEyebrow: {
    ...typography.overline,
    color: colors.primary,
  },
  metaCard: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  metaLabel: { ...typography.caption, color: colors.mutedForeground, fontWeight: "600" },
  metaValue: { ...typography.caption, color: colors.foreground, fontWeight: "700" },
  copyright: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: spacing.sm,
  },
});
