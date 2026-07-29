import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/hooks/useI18n";
import { colors, spacing, typography } from "@/theme";

export default function NotFoundScreen() {
  const { t } = useI18n();

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: t("errors.notFoundTitle") }} />
      <Text style={styles.title}>{t("errors.notFoundTitle")}</Text>
      <Text style={styles.body}>{t("errors.notFoundBody")}</Text>
      <Link href="/" asChild>
        <Button label={t("errors.notFoundCta")} />
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["2xl"],
    backgroundColor: colors.background,
    gap: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.foreground,
    textAlign: "center",
  },
  body: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
    lineHeight: 22,
  },
});
