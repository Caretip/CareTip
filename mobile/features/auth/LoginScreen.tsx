import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthEntrance } from "@/components/auth/AuthEntrance";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { AuthScreenHeader } from "@/components/auth/AuthScreenHeader";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { useAuth } from "@/hooks/useAuth";
import { useSocialAuth } from "@/hooks/useSocialAuth";
import { useI18n } from "@/hooks/useI18n";
import { createLoginSchema, type LoginFormValues } from "@/features/auth/loginSchema";
import { EMAIL_NOT_VERIFIED } from "@/constants/authErrors";
import { isMfaChallenge } from "@/types/auth";
import type { OAuthProvider } from "@/types/auth";
import { normalizeApiError } from "@/types/api";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { navigateAfterAuth } from "@/utils/postAuthNavigation";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";
import { hapticLight } from "@/utils/haptics";
import {
  authCardStyles,
  authFloatingDivider,
  authForgotStyles,
} from "@/components/auth/authCardStyles";
import { authBrand } from "@/theme/authBrand";
import { spacing, touchTarget, typography } from "@/theme";
import { authLoginLayout } from "@/utils/authLoginLayout";

function resolveTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function LoginScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ pendingEmail?: string; emailVerified?: string }>();
  const pendingEmail =
    typeof params.pendingEmail === "string" ? params.pendingEmail.trim() : "";
  const emailJustVerified =
    params.emailVerified === "1" || params.emailVerified === "true";
  const { signIn, isHydrated, status } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [showVerifyPrompt, setShowVerifyPrompt] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const {
    runSocialAuth,
    loadingProvider,
    socialBusy,
    configuredProviders,
  } = useSocialAuth({
    onAccountNotRegistered: () => router.push("/(auth)/signup" as never),
  });

  const loginSchema = useMemo(() => createLoginSchema(t), [t]);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: pendingEmail, password: "" },
  });

  useEffect(() => {
    if (pendingEmail) {
      setValue("email", pendingEmail);
    }
  }, [pendingEmail, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setShowVerifyPrompt(false);
    try {
      const result = await signIn({
        email: values.email.trim(),
        password: values.password,
        locale: resolveLoginLocale(),
        timeZone: resolveTimeZone(),
      });

      if (isMfaChallenge(result)) {
        router.push({
          pathname: "/(auth)/mfa",
          params: {
            pendingMfaToken: result.pendingMfaToken,
            mfaSetupRequired: result.mfaSetupRequired ? "1" : "0",
          },
        });
        return;
      }

      await navigateAfterAuth(router, result.user);
    } catch (error) {
      const normalized = normalizeApiError(error);
      if (normalized.code === EMAIL_NOT_VERIFIED) {
        setShowVerifyPrompt(true);
      }
      setFormError(friendlyErrorMessage(error, t("auth.signInFailed"), t));
    }
  });

  const bootstrapping = !isHydrated || status === "bootstrapping";
  const authBusy = isSubmitting || socialBusy;
  const socialBlockOffset = 3;

  const handleSocialPress = (provider: OAuthProvider) => {
    void runSocialAuth(provider, { isLogin: true });
  };

  return (
    <AuthExperienceShell>
        <View style={styles.formBlock}>
          <AuthEntrance index={0}>
            <AuthScreenHeader
              compact
              title={t("auth.loginTitle")}
              subtitle={
                emailJustVerified
                  ? t("auth.emailVerifiedSignInSubtitle")
                  : t("auth.signInSubtitle")
              }
            >
              {emailJustVerified ? (
                <Text style={styles.verifiedBanner} accessibilityRole="text">
                  {t("auth.emailVerifiedBanner")}
                </Text>
              ) : null}
            </AuthScreenHeader>
          </AuthEntrance>

          <AuthEntrance index={1}>
            <SocialAuthButtons
              providers={configuredProviders}
              loadingProvider={loadingProvider}
              disabled={authBusy || bootstrapping}
              onPressProvider={handleSocialPress}
            />
          </AuthEntrance>
          <AuthEntrance index={2}>
            <View style={authFloatingDivider.row}>
              <View style={authFloatingDivider.line} />
              <Text style={authFloatingDivider.label}>{t("auth.orContinueWith")}</Text>
              <View style={authFloatingDivider.line} />
            </View>
          </AuthEntrance>

          <AuthEntrance index={socialBlockOffset + 1}>
            <View style={styles.fields}>
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
                    placeholder={t("auth.emailPlaceholder")}
                    keyboardType="email-address"
                    textContentType="username"
                    autoComplete="email"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    editable={!authBusy}
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    error={errors.email?.message}
                  />
                )}
              />

              <Controller
                control={control}
                name="password"
                render={({ field: { onChange, onBlur, value } }) => (
                  <AuthField
                    ref={passwordRef}
                    label={t("auth.password")}
                    icon="lock-closed-outline"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder={t("auth.passwordPlaceholder")}
                    secureTextEntry
                    textContentType="password"
                    autoComplete="password"
                    returnKeyType="done"
                    editable={!authBusy}
                    onSubmitEditing={onSubmit}
                    error={errors.password?.message}
                  />
                )}
              />
            </View>
          </AuthEntrance>

          <AuthEntrance index={socialBlockOffset + 2}>
            <View style={styles.primaryActions}>
              <View style={styles.forgotRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    hapticLight();
                    router.push("/(auth)/forgot-password");
                  }}
                  style={({ pressed }) => [
                    authForgotStyles.link,
                    pressed ? authCardStyles.pressed : null,
                  ]}
                >
                  <Text style={authForgotStyles.label}>{t("auth.forgotPassword")}</Text>
                </Pressable>
              </View>

              {showVerifyPrompt ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    hapticLight();
                    router.push("/(auth)/verify-email");
                  }}
                  style={({ pressed }) => [styles.verifyPrompt, pressed ? authCardStyles.pressed : null]}
                >
                  <Text style={styles.verifyPromptLabel}>{t("auth.verifyEmailPrompt")}</Text>
                </Pressable>
              ) : null}

              {formError ? (
                <Text style={authCardStyles.formError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {formError}
                </Text>
              ) : null}

              <AuthContinueButton
                label={t("auth.signIn")}
                onPress={onSubmit}
                loading={isSubmitting}
                disabled={bootstrapping || socialBusy}
              />
            </View>
          </AuthEntrance>

          <AuthEntrance index={socialBlockOffset + 6}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t("auth.dontHaveAccount")} ${t("auth.signUpLink")}`}
              disabled={authBusy || bootstrapping}
              onPress={() => {
                hapticLight();
                router.push("/(auth)/signup" as never);
              }}
              style={({ pressed }) => [styles.signUpRow, pressed ? authCardStyles.pressed : null]}
            >
              <Text style={styles.signUpPrompt}>{t("auth.dontHaveAccount")} </Text>
              <Text style={styles.signUpLink}>{t("auth.signUpLink")}</Text>
            </Pressable>
          </AuthEntrance>
        </View>
      </AuthExperienceShell>
  );
}

const styles = StyleSheet.create({
  formBlock: {
    gap: authLoginLayout.formGap,
  },
  fields: {
    gap: authLoginLayout.fieldsGap,
  },
  primaryActions: {
    gap: spacing.sm,
  },
  forgotRow: {
    alignSelf: "stretch",
    alignItems: "flex-end",
  },
  verifiedBanner: {
    ...typography.caption,
    color: authBrand.orangeMuted,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  verifyPrompt: {
    alignSelf: "stretch",
    minHeight: touchTarget,
    justifyContent: "center",
    paddingVertical: spacing.xs,
  },
  verifyPromptLabel: {
    ...typography.caption,
    color: authBrand.orangeMuted,
    fontWeight: "600",
    textAlign: "center",
  },
  signUpRow: {
    minHeight: authLoginLayout.signUpMinHeight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xs,
    flexWrap: "wrap",
  },
  signUpPrompt: {
    ...typography.body,
    color: authBrand.heroSubtitle,
    fontWeight: "500",
  },
  signUpLink: {
    ...typography.body,
    color: authBrand.orange,
    fontWeight: "700",
  },
});
