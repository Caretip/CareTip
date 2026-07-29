import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthGlassCard } from "@/components/auth/AuthGlassCard";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { authCardStyles } from "@/components/auth/authCardStyles";
import { useI18n } from "@/hooks/useI18n";
import { forgotPasswordSchema, type ForgotPasswordFormValues } from "@/features/auth/authSchemas";
import { authService } from "@/services/auth/authService";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";
import { hapticLight } from "@/utils/haptics";
import { spacing } from "@/theme";

export function ForgotPasswordScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState("");

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await authService.requestPasswordReset(values.email.trim(), resolveLoginLocale());
      setSentEmail(values.email.trim());
      setSent(true);
    } catch (error) {
      setFormError(friendlyErrorMessage(error, t("auth.forgotPasswordFailed"), t));
    }
  });

  return (
    <AuthExperienceShell showSecondaryActions={false}>
      <AuthGlassCard>
        {sent ? (
          <View style={styles.sentBlock}>
            <Text style={authCardStyles.cardTitle}>{t("auth.forgotPasswordSentTitle")}</Text>
            <Text style={authCardStyles.cardSubtitle}>
              {t("auth.forgotPasswordSentBody", { email: sentEmail })}
            </Text>
            <AuthContinueButton
              label={t("auth.backToSignIn")}
              onPress={() => router.replace("/(auth)/login")}
            />
          </View>
        ) : (
          <>
            <View style={authCardStyles.cardHeader}>
              <Text style={authCardStyles.cardEyebrow}>{t("auth.security")}</Text>
              <Text style={authCardStyles.cardTitle}>{t("auth.forgotPasswordTitle")}</Text>
              <Text style={authCardStyles.cardSubtitle}>{t("auth.forgotPasswordSubtitle")}</Text>
            </View>

            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <AuthField
                  label={t("auth.email")}
                  icon="mail-outline"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  keyboardType="email-address"
                  textContentType="username"
                  autoComplete="email"
                  returnKeyType="done"
                  onSubmitEditing={onSubmit}
                  editable={!isSubmitting}
                  error={errors.email?.message}
                />
              )}
            />

            {formError ? (
              <Text style={authCardStyles.formError} accessibilityRole="alert">
                {formError}
              </Text>
            ) : null}

            <AuthContinueButton
              label={t("auth.sendResetLink")}
              onPress={onSubmit}
              loading={isSubmitting}
            />

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                hapticLight();
                router.back();
              }}
              style={({ pressed }) => [authCardStyles.backRow, pressed ? authCardStyles.pressed : null]}
            >
              <Text style={authCardStyles.backLink}>{t("auth.backToSignIn")}</Text>
            </Pressable>
          </>
        )}
      </AuthGlassCard>
    </AuthExperienceShell>
  );
}

const styles = StyleSheet.create({
  sentBlock: { gap: spacing.lg },
});
