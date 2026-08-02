import { useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useBusinessCustomerFeedback } from "@/features/business/useBusinessCustomerFeedback";
import { formatRating } from "@/utils/format";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { ColorPalette } from "@/theme/colors";
import { brand, spacing, surface, typography } from "@/theme";
import { uiLocaleTag } from "@/utils/labels";

type StarRatingProps = {
  rating: number;
  max?: number;
};

function StarRating({ rating, max = 5 }: StarRatingProps) {
  const { colors } = useTheme();
  const filled = Math.round(Math.min(max, Math.max(0, rating)));

  return (
    <View style={starStyles.row} accessibilityLabel={`${rating} of ${max} stars`}>
      {Array.from({ length: max }, (_, index) => (
        <Ionicons
          key={index}
          name={index < filled ? "star" : "star-outline"}
          size={14}
          color={index < filled ? brand.orange : colors.mutedForeground}
        />
      ))}
    </View>
  );
}

const starStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
});

export function CustomerFeedbackPanel() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { data, isLoading, error } = useBusinessCustomerFeedback(3);

  if (isLoading) {
    return <SkeletonListRows count={2} />;
  }

  if (error) {
    return (
      <Text style={styles.error}>
        {friendlyErrorMessage(error, t("businessDashboard.feedbackLoadError"), t)}
      </Text>
    );
  }

  const summary = data?.summary;
  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <EmptyState
        variant="tips"
        title={t("businessDashboard.noFeedbackTitle")}
        message={t("businessDashboard.noFeedbackMessage")}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      {summary && summary.feedbackCount > 0 ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{t("businessDashboard.customerFeedbackTitle")}</Text>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryRating}>{formatRating(summary.averageRating)}</Text>
            <StarRating rating={summary.averageRating ?? 0} />
          </View>
          <Text style={styles.summaryMeta}>
            {t("businessDashboard.feedbackSummary", {
              count: summary.feedbackCount,
              rating: formatRating(summary.averageRating),
            })}
          </Text>
        </View>
      ) : null}

      <View style={styles.cards}>
        {items.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.employeeName.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.cardHeaderText}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.employeeName}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {new Date(item.createdAt).toLocaleString(uiLocaleTag())}
                  {item.customerName ? ` · ${item.customerName}` : ""}
                </Text>
              </View>
              {item.rating != null ? (
                <View style={styles.ratingCol}>
                  <StarRating rating={item.rating} />
                  <Text style={styles.ratingValue}>{formatRating(item.rating)}</Text>
                </View>
              ) : null}
            </View>
            {item.comment ? (
              <Text style={styles.comment} numberOfLines={4}>
                {item.comment}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrap: {
      gap: spacing.xl,
    },
    summaryCard: {
      backgroundColor: colors.secondary,
      borderRadius: surface.cardRadius,
      padding: spacing.xl,
      gap: spacing.sm,
    },
    summaryLabel: {
      ...typography.overline,
      color: colors.mutedForeground,
      letterSpacing: 1.1,
    },
    summaryRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    summaryRating: {
      fontSize: 28,
      lineHeight: 32,
      fontWeight: "800",
      color: colors.foreground,
      letterSpacing: -0.6,
    },
    summaryMeta: {
      ...typography.caption,
      color: colors.mutedForeground,
      lineHeight: 18,
    },
    cards: {
      gap: spacing.lg,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: surface.cardRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.xl,
      gap: spacing.md,
      ...Platform.select({
        ios: {
          shadowColor: "#0B1220",
          shadowOpacity: 0.04,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        },
        android: { elevation: 2 },
        default: {},
      }),
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      ...typography.body,
      fontWeight: "700",
      color: colors.foreground,
    },
    cardHeaderText: {
      flex: 1,
      minWidth: 0,
      gap: spacing.xxs,
    },
    name: {
      ...typography.body,
      fontWeight: "700",
      color: colors.foreground,
      fontSize: 16,
      letterSpacing: -0.1,
    },
    meta: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontSize: 12,
    },
    ratingCol: {
      alignItems: "flex-end",
      gap: spacing.xxs,
    },
    ratingValue: {
      ...typography.caption,
      fontWeight: "700",
      color: colors.primary,
      fontSize: 12,
    },
    comment: {
      ...typography.body,
      color: colors.foreground,
      fontSize: 15,
      lineHeight: 22,
      letterSpacing: 0.05,
    },
    error: {
      ...typography.caption,
      color: colors.destructive,
    },
  });
}
