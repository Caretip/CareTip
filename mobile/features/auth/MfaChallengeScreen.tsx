import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { mfaSchema, type MfaFormValues } from "@/features/auth/loginSchema";
import { setupLoginMfa } from "@/services/auth/mfaService";
import { navigateAfterAuth } from "@/utils/postAuthNavigation";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { TwoFactorSetup } from "@/types/settings";
import { authCardStyles } from "@/components/auth/authCardStyles";
import { authBrand } from "@/theme/authBrand";
import { radius, spacing } from "@/theme";

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
    watch,
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
      await navigateAfterAuth(router, result.user);
    } catch (error) {
      setFormError(friendlyErrorMessage(error, t("auth.mfaFailed"), t));
    }
  });

  const codeValue = watch("code");
  const lastAutoCode = useRef("");
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    const digits = (codeValue ?? "").replace(/\D/g, "");
    if (digits.length !== 6 || isSubmitting || digits === lastAutoCode.current) return;
    lastAutoCode.current = digits;
    void onSubmitRef.current();
  }, [codeValue, isSubmitting]);

  return (
    <AuthExperienceShell showSecondaryActions={false}>
      <View style={authCardStyles.formBlock}>
        <View style={authCardStyles.cardHeader}>
          <Text style={authCardStyles.cardEyebrow}>{t("auth.security")}</Text>
          <Text style={authCardStyles.cardTitle}>
            {mfaSetupRequired ? t("auth.mfaSetupTitle") : t("auth.mfaTitle")}
          </Text>
          <Text style={authCardStyles.cardSubtitle}>
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
              textContentType="oneTimeCode"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={onSubmit}
              error={errors.code?.message}
            />
          )}
        />

        {formError ? (
          <Text style={authCardStyles.formError} accessibilityRole="alert">
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
      </View>
    </AuthExperienceShell>
  );
}

const styles = StyleSheet.create({
  qrBlock: {
    alignItems: "center",
    minHeight: 48,
  },
  qrImage: {
    width: 180,
    height: 180,
    borderRadius: radius.xl,
  },
});
