import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "@/components/ui/Avatar";
import { StatusPill } from "@/components/ui/StatusPill";
import { useI18n } from "@/hooks/useI18n";
import { colors, radius, spacing, surface, typography } from "@/theme";
import { hapticLight } from "@/utils/haptics";

type TipCardProps = {
  amount: string;
  statusLabel: string;
  statusTone?: "success" | "warning" | "danger" | "neutral" | "brand" | "info";
  staffName?: string | null;
  meta?: string;
  location?: string | null;
  onPress?: () => void;
  /** Divider row inside a grouped list — no individual card chrome. */
  inset?: boolean;
};

/** Compact tip row — divider list style, not a boxed card. */
export const TipCard = memo(function TipCard({
  amount,
  statusLabel,
  statusTone = "neutral",
  staffName,
  meta,
  location,
  onPress,
  inset = false,
}: TipCardProps) {
  const a11y = [amount, statusLabel, staffName, meta, location].filter(Boolean).join(". ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y || "Tip"}
      onPress={() => {
        hapticLight();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.row,
        inset ? styles.rowInset : styles.rowCard,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.iconWell}>
        <Avatar label={staffName ?? "Tip"} tone="brand" size={36} />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.amount}>{amount}</Text>
          <StatusPill label={statusLabel} tone={statusTone} />
        </View>
        {staffName ? <Text style={styles.staff}>{staffName}</Text> : null}
        <Text style={styles.meta} numberOfLines={1}>
          {[meta, location].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </Pressable>
  );
});

type ActivityCardProps = {
  title: string;
  subtitle?: string | null;
  meta?: string;
  amount?: string | null;
  badgeLabel: string;
  badgeTone?: "success" | "warning" | "danger" | "neutral" | "brand" | "info";
  isLast?: boolean;
};

/** Timeline-style activity row. */
export const ActivityCard = memo(function ActivityCard({
  title,
  subtitle,
  meta,
  amount,
  badgeLabel,
  badgeTone = "neutral",
  isLast = false,
}: ActivityCardProps) {
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}>
        <View style={[styles.dot, badgeTone === "success" ? styles.dotSuccess : null]} />
        {!isLast ? <View style={styles.rail} /> : null}
      </View>
      <View style={[styles.timelineBody, isLast ? styles.timelineBodyLast : null]}>
        <View style={styles.top}>
          <StatusPill label={badgeLabel} tone={badgeTone} />
          {amount ? <Text style={styles.amountAccent}>{amount}</Text> : null}
        </View>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
    </View>
  );
});

type NotificationCardProps = {
  title: string;
  message: string;
  meta: string;
  unread?: boolean;
  onPress?: () => void;
  inset?: boolean;
};

export const NotificationCard = memo(function NotificationCard({
  title,
  message,
  meta,
  unread = false,
  onPress,
  inset = false,
}: NotificationCardProps) {
  const { t } = useI18n();
  const readState = unread ? t("a11y.unread") : t("a11y.read");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${readState}`}
      onPress={() => {
        hapticLight();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.row,
        inset ? styles.rowInset : styles.rowCard,
        !inset && unread ? styles.unreadRow : null,
        inset && unread ? styles.unreadInset : null,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.iconWell, unread ? styles.iconWellUnread : null]}>
        {unread ? (
          <View style={styles.unreadDotInner} />
        ) : (
          <View style={styles.readDotInner} />
        )}
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, unread ? styles.titleUnread : null]}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {message}
        </Text>
        <Text style={styles.meta}>{meta}</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
    minHeight: 56,
  },
  rowCard: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: surface.cardRadius - 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowInset: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  body: {
    flex: 1,
    gap: 2,
  },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  amount: {
    ...typography.metric,
    fontSize: 18,
    color: colors.foreground,
  },
  amountAccent: {
    ...typography.h2,
    color: colors.primary,
    fontWeight: "700",
  },
  staff: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  title: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  titleUnread: {
    fontWeight: "700",
  },
  subtitle: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  meta: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  unreadRow: {
    borderColor: "rgba(235, 153, 44, 0.22)",
  },
  unreadInset: {
    backgroundColor: "rgba(235, 153, 44, 0.06)",
  },
  iconWell: {
    width: surface.iconWellSize,
    height: surface.iconWellSize,
    borderRadius: surface.iconWellRadius,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWellUnread: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  unreadDotInner: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  readDotInner: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
  },
  timelineRow: {
    flexDirection: "row",
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  timelineRail: {
    width: 16,
    alignItems: "center",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  dotSuccess: {
    backgroundColor: colors.success,
  },
  rail: {
    flex: 1,
    width: 2,
    backgroundColor: colors.border,
    marginTop: spacing.xs,
    minHeight: 24,
  },
  timelineBody: {
    flex: 1,
    gap: spacing.xxs,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  timelineBodyLast: {
    borderBottomWidth: 0,
  },
});
