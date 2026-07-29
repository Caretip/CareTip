import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BrandMark } from "@/components/brand/BrandMark";
import { colors, radius, shadows, spacing, surface, touchTarget, typography } from "@/theme";

type EmptyVariant = "tips" | "notifications" | "activity" | "qr" | "offline" | "generic";

type EmptyStateProps = {
  title: string;
  message?: string;
  emoji?: string;
  variant?: EmptyVariant;
  actionLabel?: string;
  onAction?: () => void;
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
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={[title, message].filter(Boolean).join(". ")}
    >
      <View style={styles.iconWrap}>
        {emoji ? (
          <Text style={styles.emoji}>{emoji}</Text>
        ) : (
          <Ionicons name={ICONS[variant]} size={24} color={colors.primary} />
        )}
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
        >
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
      <BrandMark height={16} style={styles.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: spacing.md,
    paddingVertical: spacing["3xl"],
    paddingHorizontal: spacing["2xl"],
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: surface.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadows.sm,
  },
  iconWrap: {
    width: surface.iconWellSize + 8,
    height: surface.iconWellSize + 8,
    borderRadius: surface.iconWellRadius + 4,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emoji: {
    fontSize: 22,
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
  action: {
    minHeight: touchTarget,
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing.md,
    borderRadius: surface.pillRadius,
    backgroundColor: colors.primary,
    ...shadows.sm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  actionLabel: {
    ...typography.button,
    color: colors.primaryForeground,
  },
  pressed: {
    opacity: 0.88,
  },
  brand: {
    marginTop: spacing.md,
    opacity: 0.8,
  },
});
