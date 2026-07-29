import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/hooks/useI18n";
import { colors, radius, spacing, typography } from "@/theme";

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ErrorState({ title, message, onRetry }: ErrorStateProps) {
  const { t } = useI18n();
  const resolvedTitle = title ?? t("errors.generic");

  return (
    <View style={styles.container}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>!</Text>
      </View>
      <Text style={styles.title}>{resolvedTitle}</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <View style={styles.action}>
          <Button label={t("errors.tryAgain")} onPress={onRetry} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.md,
    paddingVertical: spacing["3xl"],
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    ...typography.title,
    color: colors.primary,
    fontSize: 22,
  },
  title: {
    ...typography.cardTitle,
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
    marginTop: spacing.sm,
    alignSelf: "stretch",
  },
});
