import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthGlassCard } from "@/components/auth/AuthGlassCard";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { mfaSchema, type MfaFormValues } from "@/features/auth/loginSchema";
import { setupLoginMfa } from "@/services/auth/mfaService";
import { getDashboardRouteForRole } from "@/utils/routing";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { TwoFactorSetup } from "@/types/settings";
import { colors, radius, spacing, typography } from "@/theme";

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
            {setupLoading ? <ActivityIndicator color={colors.primary} /> : null}
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
            <TextField
              label={t("auth.mfaCode")}
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

        <Button label={t("common.continue")} onPress={onSubmit} loading={isSubmitting} />
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
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  cardEyebrow: {
    ...typography.overline,
    color: colors.primary,
  },
  cardTitle: {
    ...typography.h1,
    color: colors.foreground,
    fontSize: 24,
  },
  cardSubtitle: {
    ...typography.body,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
  qrBlock: {
    alignItems: "center",
    minHeight: 48,
    marginBottom: spacing.sm,
  },
  qrImage: {
    width: 200,
    height: 200,
    borderRadius: radius.xl,
  },
  formError: {
    ...typography.caption,
    color: colors.destructive,
    fontWeight: "600",
  },
});
