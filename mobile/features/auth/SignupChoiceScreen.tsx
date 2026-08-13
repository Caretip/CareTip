import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthScreenHeader } from "@/components/auth/AuthScreenHeader";
import { useI18n } from "@/hooks/useI18n";
import { hapticLight } from "@/utils/haptics";
import { authCardStyles } from "@/components/auth/authCardStyles";
import { authBrand } from "@/theme/authBrand";
import { radius, spacing, touchTarget, typography } from "@/theme";

/**
 * Signup entry — choose business creation vs employee invite.
 * Social buttons live on RegisterScreen, not here.
 */
export function SignupChoiceScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const styles = useMemo(() => createStyles(), []);

  return (
    <AuthExperienceShell showSecondaryActions={false}>
      <View style={authCardStyles.formBlock}>
        <AuthScreenHeader
          title={t("auth.createAccountTitle")}
          subtitle={t("auth.createAccountSubtitle")}
        />

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("auth.createBusinessChoiceTitle")}
            onPress={() => {
              hapticLight();
              router.push("/(auth)/register");
            }}
            style={({ pressed }) => [styles.choice, pressed ? authCardStyles.pressed : null]}
          >
            <Ionicons name="storefront-outline" size={22} color={authBrand.orange} />
            <View style={styles.choiceCopy}>
              <Text style={styles.choiceTitle}>{t("auth.createBusinessChoiceTitle")}</Text>
              <Text style={styles.choiceBody}>{t("auth.createBusinessChoiceBody")}</Text>
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("auth.joinInviteChoiceTitle")}
            onPress={() => {
              hapticLight();
              router.push("/(auth)/join");
            }}
            style={({ pressed }) => [styles.choice, pressed ? authCardStyles.pressed : null]}
          >
            <Ionicons name="ticket-outline" size={22} color={authBrand.orange} />
            <View style={styles.choiceCopy}>
              <Text style={styles.choiceTitle}>{t("auth.joinInviteChoiceTitle")}</Text>
              <Text style={styles.choiceBody}>{t("auth.joinInviteChoiceBody")}</Text>
            </View>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            hapticLight();
            if (router.canGoBack()) router.back();
            else router.replace("/(auth)/login");
          }}
          style={({ pressed }) => [styles.signInRow, pressed ? authCardStyles.pressed : null]}
        >
          <Text style={styles.signInPrompt}>{t("auth.alreadyHaveAccount")} </Text>
          <Text style={styles.signInLink}>{t("auth.signInLink")}</Text>
        </Pressable>
      </View>
    </AuthExperienceShell>
  );
}

function createStyles() {
  return StyleSheet.create({
    actions: {
      gap: spacing.md,
    },
    choice: {
      minHeight: touchTarget + 8,
      borderRadius: radius["2xl"],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: authBrand.fieldBorder,
      backgroundColor: authBrand.fieldFill,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
    },
    choiceCopy: {
      flex: 1,
      gap: spacing.xs,
    },
    choiceTitle: {
      ...typography.button,
      color: authBrand.heroTitle,
      fontWeight: "700",
      fontSize: 16,
    },
    choiceBody: {
      ...typography.caption,
      color: authBrand.heroSubtitle,
      lineHeight: 18,
      fontWeight: "500",
    },
    signInRow: {
      minHeight: touchTarget,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.sm,
      flexWrap: "wrap",
    },
    signInPrompt: {
      ...typography.body,
      color: authBrand.heroSubtitle,
      fontWeight: "500",
    },
    signInLink: {
      ...typography.body,
      color: authBrand.orange,
      fontWeight: "700",
    },
  });
}
