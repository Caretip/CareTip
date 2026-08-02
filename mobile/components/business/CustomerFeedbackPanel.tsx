import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useBusinessCustomerFeedback } from "@/features/business/useBusinessCustomerFeedback";
import { formatRating } from "@/utils/format";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { ColorPalette } from "@/theme/colors";
import { premiumPalette } from "@/theme/dashboardPremium";
import { spacing, typography } from "@/theme";
import { uiLocaleTag } from "@/utils/labels";

type StarRatingProps = {
  rating: number;
  max?: number;
};

function StarRating({ rating, max = 5 }: StarRatingProps) {
  const filled = Math.round(Math.min(max, Math.max(0, rating)));

  return (
    <View style={starStyles.row} accessibilityLabel={`${rating} of ${max} stars`}>
      {Array.from({ length: max }, (_, index) => (
        <Ionicons
          key={index}
          name={index < filled ? "star" : "star-outline"}
          size={14}
          color={index < filled ? premiumPalette.starGold : premiumPalette.textMuted}
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
        <View style={styles.summary}>
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

      <View style={styles.reviews}>
        {items.map((item, index) => (
          <View
            key={item.id}
            style={[styles.review, index < items.length - 1 ? styles.reviewBorder : null]}
          >
            <View style={styles.reviewHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.employeeName.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.reviewMeta}>
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
    summary: {
      gap: spacing.xs,
      paddingBottom: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: premiumPalette.border,
    },
    summaryRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    summaryRating: {
      fontSize: 28,
      lineHeight: 32,
      fontWeight: "700",
      color: premiumPalette.textPrimary,
      letterSpacing: -0.6,
    },
    summaryMeta: {
      ...typography.caption,
      color: premiumPalette.textSecondary,
      lineHeight: 18,
      fontSize: 13,
    },
    reviews: {
      gap: 0,
    },
    review: {
      paddingVertical: spacing.lg,
      gap: spacing.sm,
    },
    reviewBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: premiumPalette.border,
    },
    reviewHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontWeight: "700",
      color: premiumPalette.textPrimary,
      fontSize: 14,
    },
    reviewMeta: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    name: {
      ...typography.body,
      fontWeight: "600",
      color: premiumPalette.textPrimary,
      fontSize: 15,
    },
    meta: {
      ...typography.caption,
      color: premiumPalette.textMuted,
      fontSize: 11,
    },
    ratingCol: {
      alignItems: "flex-end",
    },
    comment: {
      ...typography.body,
      color: premiumPalette.textSecondary,
      fontSize: 14,
      lineHeight: 21,
      paddingLeft: 36 + spacing.md,
    },
    error: {
      ...typography.caption,
      color: colors.destructive,
    },
  });
}
