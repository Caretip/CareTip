import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader, HeroCard } from "@/components/ui/ScreenHeader";
import { Divider, Section } from "@/components/ui/Section";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { colors, spacing, typography } from "@/theme";

/**
 * Admin mobile is intentionally limited (no platform analytics on device).
 * Does not invent KPIs — session confirmation + sign-out only.
 */
export default function AdminDashboardRoute() {
  const router = useRouter();
  const { t } = useI18n();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  return (
    <Screen>
      <HeroCard>
        <ScreenHeader
          eyebrow={t("roles.admin")}
          title={t("admin.title")}
          subtitle={t("admin.subtitle")}
        />
      </HeroCard>

      <Section title={t("admin.title")} subtitle={t("admin.subtitle")}>
        <Text style={styles.body}>{t("admin.body")}</Text>
        {user?.email ? (
          <>
            <Divider />
            <Text style={styles.email}>{user.email}</Text>
          </>
        ) : null}
      </Section>

      <View style={styles.footer}>
        <Button label={t("settings.signOut")} variant="outline" onPress={() => void handleSignOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: colors.foreground,
  },
  email: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  footer: {
    marginTop: spacing.xl,
  },
});
