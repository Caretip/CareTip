import { useMemo } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { InfoScreenShell } from "@/components/info/InfoScreenShell";
import { CONTACT_CHANNEL_DEFS } from "@/constants/infoContent";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import {
  getBusinessHoursRows,
  getContactChannelSubtitle,
  getContactChannelTitle,
  type ContactChannelId,
} from "@/utils/infoI18n";
import { authBrand } from "@/theme/authBrand";
import type { ColorPalette } from "@/theme/colors";
import { radius, spacing, touchTarget, typography } from "@/theme";
import { hapticLight } from "@/utils/haptics";

export function ContactScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const hoursRows = getBusinessHoursRows(t);

  const openChannel = async (href: string) => {
    hapticLight();
    await Linking.openURL(href);
  };
  return (
    <InfoScreenShell title={t("info.contactTitle")}>
      <Text style={styles.lead}>{t("info.contactLead")}</Text>
      {CONTACT_CHANNEL_DEFS.map((channel) => (
        <Pressable
          key={channel.id}
          style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
          onPress={() => void openChannel(channel.href)}
          accessibilityRole="button"
          accessibilityLabel={`${getContactChannelTitle(t, channel.id as ContactChannelId)}. ${getContactChannelSubtitle(t, channel.id as ContactChannelId)}`}
        >
          <View style={styles.iconWrap}>
            <Ionicons name={channel.icon} size={22} color={authBrand.orange} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>
              {getContactChannelTitle(t, channel.id as ContactChannelId)}
            </Text>
            <Text style={styles.cardSub}>
              {getContactChannelSubtitle(t, channel.id as ContactChannelId)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </Pressable>
      ))}

      <Text style={styles.section}>{t("info.businessHours")}</Text>
      <View style={styles.hoursCard}>
        {hoursRows.map((row) => (
          <View key={row.day} style={styles.hoursRow}>
            <Text style={styles.hoursDay}>{row.day}</Text>
            <Text style={styles.hoursTime}>{row.hours}</Text>
          </View>
        ))}
      </View>
    </InfoScreenShell>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    lead: {
      ...typography.body,
      color: colors.mutedForeground,
      lineHeight: 22,
    },
    card: {
      minHeight: touchTarget + 12,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    pressed: { opacity: 0.85 },
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: "rgba(235, 153, 44, 0.12)",
      alignItems: "center",
      justifyContent: "center",
    },
    cardText: { flex: 1, gap: 2 },
    cardTitle: { ...typography.h2, fontSize: 16, color: colors.foreground },
    cardSub: { ...typography.caption, color: colors.mutedForeground },
    section: {
      ...typography.overline,
      color: colors.mutedForeground,
      marginTop: spacing.md,
    },
    hoursCard: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      padding: spacing.xl,
      gap: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    hoursRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    hoursDay: { ...typography.body, color: colors.foreground, fontWeight: "600" },
    hoursTime: { ...typography.body, color: colors.mutedForeground },
  });
}
