import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { AuthRegisterSheet } from "@/components/auth/AuthRegisterSheet";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { useAuth } from "@/hooks/useAuth";
import { useGoogleAuth } from "@/hooks/useGoogleAuth";
import { useI18n } from "@/hooks/useI18n";
import { loginSchema, type LoginFormValues } from "@/features/auth/loginSchema";
import { EMAIL_NOT_VERIFIED } from "@/constants/authErrors";
import { isMfaChallenge } from "@/types/auth";
import { normalizeApiError } from "@/types/api";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { navigateAfterAuth } from "@/utils/postAuthNavigation";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";
import { hapticLight } from "@/utils/haptics";
import { authCardStyles, authFloatingDivider } from "@/components/auth/authCardStyles";
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
  const { signIn, isHydrated, status, isAuthenticated, user } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [showVerifyPrompt, setShowVerifyPrompt] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const { runGoogleAuth, googleLoading, googleConfigured } = useGoogleAuth({
    onAccountNotRegistered: () => setRegisterOpen(true),
  });

  useEffect(() => {
    if (isHydrated && isAuthenticated && user?.role) {
      void navigateAfterAuth(router, user);
    }
  }, [isHydrated, isAuthenticated, user, router]);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

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
  const authBusy = isSubmitting || googleLoading;

  return (
    <>
      <AuthExperienceShell onRegisterPress={() => setRegisterOpen(true)}>
        <View style={authCardStyles.formBlock}>
          <View style={authCardStyles.cardHeader}>
            <Text style={authCardStyles.cardEyebrow}>{t("auth.welcomeBack")}</Text>
            <Text style={authCardStyles.cardTitle}>{t("auth.loginTitle")}</Text>
            <Text style={authCardStyles.cardSubtitle}>{t("auth.signInSubtitle")}</Text>
          </View>

          {googleConfigured ? (
            <>
              <GoogleAuthButton
                label={t("auth.continueWithGoogle")}
                loading={googleLoading}
                disabled={authBusy || bootstrapping}
                onPress={() => void runGoogleAuth({ isLogin: true })}
              />
              <View style={authFloatingDivider.row}>
                <View style={authFloatingDivider.line} />
                <Text style={authFloatingDivider.label}>{t("auth.orContinueWith")}</Text>
                <View style={authFloatingDivider.line} />
              </View>
            </>
          ) : null}

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

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              hapticLight();
              router.push("/(auth)/forgot-password");
            }}
            style={({ pressed }) => [styles.forgotLink, pressed ? authCardStyles.pressed : null]}
          >
            <Text style={styles.forgotLabel}>{t("auth.forgotPassword")}</Text>
          </Pressable>

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
            disabled={bootstrapping || googleLoading}
          />
        </View>
      </AuthExperienceShell>

      <AuthRegisterSheet
        visible={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onSignIn={() => setRegisterOpen(false)}
        googleLoading={googleLoading}
        onContinueWithGoogle={() =>
          void runGoogleAuth({ isLogin: false, intendedRole: "MANAGER" }).finally(() =>
            setRegisterOpen(false),
          )
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  forgotLink: {
    alignSelf: "flex-end",
    minHeight: touchTarget,
    justifyContent: "center",
    paddingVertical: spacing.xs,
  },
  forgotLabel: {
    ...typography.caption,
    color: authBrand.orangeSoft,
    fontWeight: "700",
    fontSize: 13,
  },
  verifyPrompt: {
    alignSelf: "stretch",
    minHeight: touchTarget,
    justifyContent: "center",
    paddingVertical: spacing.xs,
  },
  verifyPromptLabel: {
    ...typography.caption,
    color: authBrand.orangeSoft,
    fontWeight: "600",
    textAlign: "center",
  },
});
