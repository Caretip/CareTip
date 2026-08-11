import { useMemo } from "react";
import { Redirect } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader, HeroCard } from "@/components/ui/ScreenHeader";
import { Divider, Section } from "@/components/ui/Section";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { getDashboardRouteForRole } from "@/utils/routing";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";

/**
 * Admin mobile is intentionally limited (no platform analytics on device).
 * Does not invent KPIs — session confirmation + sign-out only.
 */
export default function AdminDashboardRoute() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, signOut } = useAuth();

  if (user?.role && user.role !== "SUPER_ADMIN") {
    return <Redirect href={getDashboardRouteForRole(user.role)} />;
  }

  const handleSignOut = async () => {
    await signOut();
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

      <Section title={t("admin.title")} highlighted>
        <Text style={styles.body}>{t("admin.body")}</Text>
        {user?.email ? (
          <>
            <Divider />
            <Text style={styles.emailLabel}>{t("auth.email")}</Text>
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

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    body: {
      ...typography.body,
      color: colors.foreground,
      lineHeight: 24,
    },
    emailLabel: {
      ...typography.overline,
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 0.8,
      marginBottom: spacing.xxs,
    },
    email: {
      ...typography.body,
      color: colors.foreground,
      fontWeight: "600",
    },
    footer: {
      marginTop: spacing.xl,
    },
  });
}
