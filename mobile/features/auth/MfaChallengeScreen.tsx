import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthGlassCard } from "@/components/auth/AuthGlassCard";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { mfaSchema, type MfaFormValues } from "@/features/auth/loginSchema";
import { setupLoginMfa } from "@/services/auth/mfaService";
import { getDashboardRouteForRole } from "@/utils/routing";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { TwoFactorSetup } from "@/types/settings";
import { authBrand } from "@/theme/authBrand";
import { radius, spacing, typography } from "@/theme";

export function MfaChallengeScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { completeMfaSignIn } = useAuth();
  const params = useLocalSearchParams<{
    pendingMfaToken?: string;
    mfaSetupRequired?: string;
  }>();
  const [formError, setFormError] = useState<string | null>(null);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);

  const pendingMfaToken = typeof params.pendingMfaToken === "string" ? params.pendingMfaToken : "";
  const mfaSetupRequired = params.mfaSetupRequired === "1";

  useEffect(() => {
    if (!mfaSetupRequired || !pendingMfaToken) return;
    let cancelled = false;
    setSetupLoading(true);
    void setupLoginMfa(pendingMfaToken)
      .then((data) => {
        if (!cancelled) setSetup(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setFormError(friendlyErrorMessage(error, t("auth.mfaSetupFailed"), t));
        }
      })
      .finally(() => {
        if (!cancelled) setSetupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mfaSetupRequired, pendingMfaToken, t]);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<MfaFormValues>({
    resolver: zodResolver(mfaSchema),
    defaultValues: { code: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!pendingMfaToken) {
      setFormError(t("auth.mfaExpired"));
      return;
    }

    setFormError(null);
    try {
      const result = await completeMfaSignIn({
        pendingMfaToken,
        code: values.code.trim(),
        mfaSetupRequired,
      });
      router.replace(getDashboardRouteForRole(result.user.role));
    } catch (error) {
      setFormError(friendlyErrorMessage(error, t("auth.mfaFailed"), t));
    }
  });

  return (
    <AuthExperienceShell showSecondaryActions={false}>
      <AuthGlassCard>
        <View style={styles.cardHeader}>
          <Text style={styles.cardEyebrow}>{t("auth.security")}</Text>
          <Text style={styles.cardTitle}>
            {mfaSetupRequired ? t("auth.mfaSetupTitle") : t("auth.mfaTitle")}
          </Text>
          <Text style={styles.cardSubtitle}>
            {mfaSetupRequired ? t("auth.mfaSetupSubtitle") : t("auth.mfaSubtitle")}
          </Text>
        </View>

        {mfaSetupRequired ? (
          <View style={styles.qrBlock}>
            {setupLoading ? <ActivityIndicator color={authBrand.orange} /> : null}
            {setup?.qrDataUrl ? (
              <Image
                source={{ uri: setup.qrDataUrl }}
                style={styles.qrImage}
                accessibilityLabel={t("auth.qrA11y")}
              />
            ) : null}
          </View>
        ) : null}

        <Controller
          control={control}
          name="code"
          render={({ field: { onChange, onBlur, value } }) => (
            <AuthField
              label={t("auth.mfaCode")}
              icon="keypad-outline"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              error={errors.code?.message}
            />
          )}
        />

        {formError ? (
          <Text style={styles.formError} accessibilityRole="alert">
            {formError}
          </Text>
        ) : null}

        <AuthContinueButton
          label={t("common.continue")}
          onPress={onSubmit}
          loading={isSubmitting}
        />
        <Button
          label={t("auth.backToSignIn")}
          variant="ghost"
          onPress={() => router.replace("/(auth)/login")}
        />
      </AuthGlassCard>
    </AuthExperienceShell>
  );
}

const styles = StyleSheet.create({
  cardHeader: {
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  cardEyebrow: {
    ...typography.overline,
    color: authBrand.orange,
    letterSpacing: 1.4,
    fontSize: 11,
  },
  cardTitle: {
    ...typography.hero,
    color: authBrand.dark,
    fontSize: 26,
    letterSpacing: -0.5,
  },
  cardSubtitle: {
    ...typography.body,
    color: authBrand.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  qrBlock: {
    alignItems: "center",
    minHeight: 48,
  },
  qrImage: {
    width: 180,
    height: 180,
    borderRadius: radius.xl,
  },
  formError: {
    ...typography.caption,
    color: "#E11D48",
    fontWeight: "600",
  },
});
