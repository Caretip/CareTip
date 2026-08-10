import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { AuthScreenHeader } from "@/components/auth/AuthScreenHeader";
import { useI18n } from "@/hooks/useI18n";
import {
  createResetPasswordSchema,
  type ResetPasswordFormValues,
} from "@/features/auth/authSchemas";
import { authService } from "@/services/auth/authService";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { hapticLight } from "@/utils/haptics";
import { authCardStyles } from "@/components/auth/authCardStyles";
import { spacing } from "@/theme";

export function ResetPasswordScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token.trim() : "";
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const resetPasswordSchema = useMemo(() => createResetPasswordSchema(t), [t]);

  useEffect(() => {
    if (!token) {
      setFormError(t("auth.resetPasswordInvalidToken"));
    }
  }, [token, t]);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!token) return;
    setFormError(null);
    try {
      await authService.resetPasswordWithToken(token, values.password);
      setDone(true);
    } catch (error) {
      setFormError(friendlyErrorMessage(error, t("auth.resetPasswordFailed"), t));
    }
  });

  return (
    <AuthExperienceShell showSecondaryActions={false}>
      <View style={authCardStyles.formBlock}>
        {done ? (
          <View style={styles.block}>
            <Text style={authCardStyles.cardTitle}>{t("auth.resetPasswordSuccessTitle")}</Text>
            <Text style={authCardStyles.cardSubtitle}>{t("auth.resetPasswordSuccessBody")}</Text>
            <AuthContinueButton
              label={t("auth.backToSignIn")}
              onPress={() => router.replace("/(auth)/login")}
            />
          </View>
        ) : (
          <>
            <AuthScreenHeader
              title={t("auth.resetPasswordTitle")}
              subtitle={t("auth.resetPasswordSubtitle")}
            />

            <View style={authCardStyles.fields}>
              <Controller
                control={control}
                name="password"
                render={({ field: { onChange, onBlur, value } }) => (
                  <AuthField
                    label={t("auth.newPassword")}
                    icon="lock-closed-outline"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder={t("auth.passwordPlaceholder")}
                    secureTextEntry
                    textContentType="newPassword"
                    autoComplete="password-new"
                    editable={!isSubmitting && Boolean(token)}
                    error={errors.password?.message}
                  />
                )}
              />
              <Controller
                control={control}
                name="confirmPassword"
                render={({ field: { onChange, onBlur, value } }) => (
                  <AuthField
                    label={t("auth.confirmPassword")}
                    icon="lock-closed-outline"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder={t("auth.confirmPasswordPlaceholder")}
                    secureTextEntry
                    textContentType="newPassword"
                    returnKeyType="done"
                    onSubmitEditing={onSubmit}
                    editable={!isSubmitting && Boolean(token)}
                    error={errors.confirmPassword?.message}
                  />
                )}
              />
            </View>

            {formError ? (
              <Text style={authCardStyles.formError} accessibilityRole="alert">
                {formError}
              </Text>
            ) : null}

            <AuthContinueButton
              label={t("auth.resetPasswordCta")}
              onPress={onSubmit}
              loading={isSubmitting}
              disabled={!token}
            />

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                hapticLight();
                router.replace("/(auth)/login");
              }}
              style={({ pressed }) => [authCardStyles.backRow, pressed ? authCardStyles.pressed : null]}
            >
              <Text style={authCardStyles.backLink}>{t("auth.backToSignIn")}</Text>
            </Pressable>
          </>
        )}
      </View>
    </AuthExperienceShell>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.lg },
});
