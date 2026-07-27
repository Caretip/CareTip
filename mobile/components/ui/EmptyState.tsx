import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BrandMark } from "@/components/brand/BrandMark";
import { colors, radius, spacing, typography } from "@/theme";

type EmptyVariant = "tips" | "notifications" | "activity" | "qr" | "offline" | "generic";

type EmptyStateProps = {
  title: string;
  message?: string;
  emoji?: string;
  variant?: EmptyVariant;
};

const ICONS: Record<EmptyVariant, keyof typeof Ionicons.glyphMap> = {
  tips: "wallet-outline",
  notifications: "notifications-outline",
  activity: "pulse-outline",
  qr: "qr-code-outline",
  offline: "cloud-offline-outline",
  generic: "sparkles-outline",
};

export function EmptyState({
  title,
  message,
  emoji,
  variant = "generic",
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        {emoji ? (
          <Text style={styles.emoji}>{emoji}</Text>
        ) : (
          <Ionicons name={ICONS[variant]} size={22} color={colors.primary} />
        )}
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <BrandMark height={16} style={styles.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.xl,
    paddingVertical: spacing["3xl"],
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emoji: {
    fontSize: 20,
    color: colors.primary,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
    textAlign: "center",
  },
  message: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
    maxWidth: 300,
  },
  brand: {
    marginTop: spacing.md,
    opacity: 0.8,
  },
});
