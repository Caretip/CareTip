import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { GroupedList, GroupedRow } from "@/components/ui/Section";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useBusinessCustomerFeedback } from "@/features/business/useBusinessCustomerFeedback";
import { formatRating } from "@/utils/format";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";
import { uiLocaleTag } from "@/utils/labels";

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
        <Text style={styles.subtitle}>
          {t("businessDashboard.feedbackSummary", {
            count: summary.feedbackCount,
            rating: formatRating(summary.averageRating),
          })}
        </Text>
      ) : null}

      <GroupedList>
        {items.map((item, index) => (
          <GroupedRow key={item.id} showDivider={index < items.length - 1}>
            <View style={styles.row}>
              <View style={styles.rowTop}>
                <Text style={styles.name}>{item.employeeName}</Text>
                {item.rating != null ? (
                  <Text style={styles.rating}>{formatRating(item.rating)}</Text>
                ) : null}
              </View>
              {item.comment ? (
                <Text style={styles.comment} numberOfLines={3}>
                  {item.comment}
                </Text>
              ) : null}
              <Text style={styles.meta}>
                {new Date(item.createdAt).toLocaleString(uiLocaleTag())}
                {item.customerName ? ` · ${item.customerName}` : ""}
              </Text>
            </View>
          </GroupedRow>
        ))}
      </GroupedList>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrap: { gap: spacing.md },
    subtitle: {
      ...typography.caption,
      color: colors.mutedForeground,
    },
    error: {
      ...typography.caption,
      color: colors.destructive,
    },
    row: { gap: spacing.xs },
    rowTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.md,
    },
    name: {
      ...typography.body,
      fontWeight: "700",
      color: colors.foreground,
      flex: 1,
    },
    rating: {
      ...typography.body,
      fontWeight: "700",
      color: colors.primary,
    },
    comment: {
      ...typography.body,
      color: colors.foreground,
      lineHeight: 20,
    },
    meta: {
      ...typography.caption,
      color: colors.mutedForeground,
    },
  });
}
