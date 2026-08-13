import { useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { AuthScreenHeader } from "@/components/auth/AuthScreenHeader";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { useI18n } from "@/hooks/useI18n";
import { useSocialAuth } from "@/hooks/useSocialAuth";
import {
  createManagerRegisterSchema,
  type ManagerRegisterFormValues,
} from "@/features/auth/authSchemas";
import { authService } from "@/services/auth/authService";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";
import { hapticLight } from "@/utils/haptics";
import { authCardStyles, authFloatingDivider } from "@/components/auth/authCardStyles";
import { authBrand } from "@/theme/authBrand";
import { spacing, touchTarget, typography } from "@/theme";
import type { OAuthProvider } from "@/types/auth";

function goToSignupChoice(router: ReturnType<typeof useRouter>) {
  if (router.canGoBack()) router.back();
  else router.replace("/(auth)/signup" as never);
}

/**
 * Manager / business registration only.
 * Employees do not register here — they complete an invitation via AcceptInviteScreen.
 * Social signup uses the existing useSocialAuth → POST /api/auth/oauth path.
 */
export function RegisterScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ role?: string; inviteCode?: string; businessName?: string }>();
  const [formError, setFormError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const managerRegisterSchema = useMemo(() => createManagerRegisterSchema(t), [t]);

  const {
    runSocialAuth,
    configuredProviders,
    loadingProvider,
    socialBusy,
  } = useSocialAuth();

  const legacyEmployeeInvite =
    params.role === "employee" ||
    (typeof params.inviteCode === "string" && params.inviteCode.trim().length > 0);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<ManagerRegisterFormValues>({
    resolver: zodResolver(managerRegisterSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  if (legacyEmployeeInvite) {
    return (
      <Redirect
        href={{
          pathname: "/(auth)/accept-invite",
          params: {
            ...(typeof params.inviteCode === "string" && params.inviteCode.trim()
              ? { inviteCode: params.inviteCode.trim() }
              : {}),
            ...(typeof params.businessName === "string" && params.businessName
              ? { businessName: params.businessName }
              : {}),
          },
        }}
      />
    );
  }

  const busy = isSubmitting || socialBusy;

  const onSocial = (provider: OAuthProvider) => {
    void runSocialAuth(provider, { isLogin: false, intendedRole: "MANAGER" });
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const created = await authService.register({
        email: values.email.trim(),
        password: values.password,
        role: "business",
        locale: resolveLoginLocale(),
      });
      router.replace({
        pathname: "/(auth)/verify-email",
        params: { pendingEmail: created.email, pendingRole: created.role },
      });
    } catch (error) {
      setFormError(friendlyErrorMessage(error, t("auth.registerFailed"), t));
    }
  });

  return (
    <AuthExperienceShell showSecondaryActions={false}>
      <View style={authCardStyles.formBlock}>
        <AuthScreenHeader
          title={t("auth.registerScreenTitle")}
          subtitle={t("auth.registerScreenSubtitle")}
        />

        <SocialAuthButtons
          providers={configuredProviders}
          loadingProvider={loadingProvider}
          disabled={busy}
          onPressProvider={onSocial}
        />
        <View style={authFloatingDivider.row}>
          <View style={authFloatingDivider.line} />
          <Text style={authFloatingDivider.label}>{t("auth.orContinueWith")}</Text>
          <View style={authFloatingDivider.line} />
        </View>

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
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!busy}
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
                textContentType="newPassword"
                autoComplete="password-new"
                returnKeyType="next"
                editable={!busy}
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
                editable={!busy}
                error={errors.confirmPassword?.message}
              />
            )}
          />
        </View>

        {formError ? (
          <Text style={authCardStyles.formError} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {formError}
          </Text>
        ) : null}

        <AuthContinueButton
          label={t("auth.createBusinessAccountCta")}
          onPress={onSubmit}
          loading={isSubmitting}
          disabled={socialBusy}
        />

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            if (busy) return;
            hapticLight();
            goToSignupChoice(router);
          }}
          style={({ pressed }) => [styles.backRow, pressed ? authCardStyles.pressed : null]}
        >
          <Text style={authCardStyles.backLink}>{t("auth.backToSignupChoice")}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            hapticLight();
            router.replace("/(auth)/login");
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

const styles = StyleSheet.create({
  backRow: {
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xs,
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
  },
  signInLink: {
    ...typography.body,
    color: authBrand.orange,
    fontWeight: "700",
  },
});
