import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthEntrance } from "@/components/auth/AuthEntrance";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { AuthRegisterSheet } from "@/components/auth/AuthRegisterSheet";
import { AuthScreenHeader } from "@/components/auth/AuthScreenHeader";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { useAuth } from "@/hooks/useAuth";
import { useAuthLogoutTransitionActive } from "@/hooks/useAuthLogoutTransition";
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
  const { signIn, isHydrated, status, isAuthenticated, user } = useAuth();
  const logoutTransition = useAuthLogoutTransitionActive();
  const [formError, setFormError] = useState<string | null>(null);
  const [showVerifyPrompt, setShowVerifyPrompt] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const {
    runSocialAuth,
    loadingProvider,
    socialBusy,
    anySocialConfigured,
    configuredProviders,
  } = useSocialAuth({
    onAccountNotRegistered: () => setRegisterOpen(true),
  });

  const loginSchema = useMemo(() => createLoginSchema(t), [t]);

  useEffect(() => {
    if (logoutTransition) return;
    if (isHydrated && isAuthenticated && user?.role) {
      void navigateAfterAuth(router, user);
    }
  }, [isHydrated, isAuthenticated, user, router, logoutTransition]);

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
  const socialBlockOffset = anySocialConfigured ? 3 : 0;

  const handleSocialPress = (provider: OAuthProvider) => {
    void runSocialAuth(provider, { isLogin: true });
  };

  return (
    <>
      <AuthExperienceShell onRegisterPress={() => setRegisterOpen(true)}>
        <View style={authCardStyles.formBlock}>
          <AuthEntrance index={0}>
            <AuthScreenHeader
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

          {anySocialConfigured ? (
            <>
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
            </>
          ) : null}

          <AuthEntrance index={socialBlockOffset + 1}>
            <View style={authCardStyles.fields}>
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
            <View style={authForgotStyles.row}>
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
          </AuthEntrance>

          {showVerifyPrompt ? (
            <AuthEntrance index={socialBlockOffset + 3}>
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
            </AuthEntrance>
          ) : null}

          {formError ? (
            <AuthEntrance index={socialBlockOffset + 3}>
              <Text style={authCardStyles.formError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {formError}
              </Text>
            </AuthEntrance>
          ) : null}

          <AuthEntrance index={socialBlockOffset + 5}>
            <AuthContinueButton
              label={t("auth.signIn")}
              onPress={onSubmit}
              loading={isSubmitting}
              disabled={bootstrapping || socialBusy}
            />
          </AuthEntrance>
        </View>
      </AuthExperienceShell>

      <AuthRegisterSheet
        visible={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onSignIn={() => setRegisterOpen(false)}
        socialLoadingProvider={loadingProvider}
        configuredProviders={configuredProviders}
        onContinueWithProvider={(provider) =>
          void runSocialAuth(provider, { isLogin: false, intendedRole: "MANAGER" }).finally(() =>
            setRegisterOpen(false),
          )
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
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
});
