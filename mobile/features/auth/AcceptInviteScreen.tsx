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
import { authService } from "@/services/auth/authService";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";
import { hapticLight } from "@/utils/haptics";
import {
  authCardStyles,
  authFloatingDivider,
} from "@/components/auth/authCardStyles";
import { authBrand } from "@/theme/authBrand";
import { spacing, typography } from "@/theme";
import type { OAuthProvider } from "@/types/auth";
import { z } from "zod";

const acceptInviteSchema = z
  .object({
    name: z.string().trim().min(1, "Please enter your name."),
    email: z
      .string()
      .trim()
      .min(1, "Please enter your email address.")
      .email("Please enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Please confirm your password."),
  })
  .superRefine((values, ctx) => {
    if (values.password !== values.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        message: "Passwords do not match.",
        path: ["confirmPassword"],
      });
    }
  });

type AcceptInviteFormValues = z.infer<typeof acceptInviteSchema>;

/**
 * Employee invitation completion — identity verification only.
 * Admission already happened when the business issued the invite.
 * OAuth never creates employment; it only links identity to the invited account.
 */
export function AcceptInviteScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const params = useLocalSearchParams<{
    inviteCode?: string;
    businessName?: string;
    employeeName?: string;
  }>();
  const inviteCode = typeof params.inviteCode === "string" ? params.inviteCode.trim() : "";
  const venueName = typeof params.businessName === "string" ? params.businessName : "";
  const welcomeName = typeof params.employeeName === "string" ? params.employeeName.trim() : "";

  const [formError, setFormError] = useState<string | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const {
    runSocialAuth,
    configuredProviders,
    anySocialConfigured,
    loadingProvider,
    socialBusy,
  } = useSocialAuth();

  const {
    control,
    handleSubmit,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<AcceptInviteFormValues>({
    resolver: zodResolver(acceptInviteSchema),
    defaultValues: {
      name: welcomeName,
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const displayName = watch("name");

  if (!inviteCode) {
    return <Redirect href="/(auth)/join" />;
  }

  const busy = isSubmitting || socialBusy;

  const onSocial = (provider: OAuthProvider) => {
    const name = displayName?.trim();
    if (!name) {
      setFormError(t("auth.acceptInviteNameRequired"));
      return;
    }
    setFormError(null);
    void runSocialAuth(provider, {
      isLogin: false,
      intendedRole: "EMPLOYEE",
      name,
      inviteCode,
    });
  };

  const onPasswordSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await authService.validateInviteCode(inviteCode);
      const created = await authService.register({
        email: values.email.trim(),
        password: values.password,
        name: values.name.trim(),
        role: "employee",
        inviteCode,
        locale: resolveLoginLocale(),
      });
      router.replace({
        pathname: "/(auth)/verify-email",
        params: { pendingEmail: created.email, pendingRole: created.role },
      });
    } catch (error) {
      setFormError(friendlyErrorMessage(error, t("auth.acceptInviteFailed"), t));
    }
  });

  const subtitle = venueName
    ? t("auth.acceptInviteSubtitleVenue", { name: venueName })
    : t("auth.acceptInviteSubtitle");

  const welcomeTitle =
    welcomeName || displayName?.trim()
      ? t("auth.acceptInviteWelcome", {
          name: welcomeName || displayName.trim(),
        })
      : t("auth.acceptInviteTitle");

  return (
    <AuthExperienceShell showSecondaryActions={false}>
      <View style={authCardStyles.formBlock}>
        <AuthScreenHeader title={welcomeTitle} subtitle={subtitle} />

        <Text style={styles.chooseLabel}>{t("auth.acceptInviteChooseMethod")}</Text>

        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, onBlur, value } }) => (
            <AuthField
              label={t("auth.fullName")}
              icon="person-outline"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder={t("auth.fullNamePlaceholder")}
              autoComplete="name"
              editable={!busy}
              error={errors.name?.message}
            />
          )}
        />

        {anySocialConfigured ? (
          <View style={styles.socialBlock}>
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
          </View>
        ) : null}

        {!showPasswordForm ? (
          <AuthContinueButton
            label={t("auth.acceptInviteCreatePassword")}
            onPress={() => {
              hapticLight();
              setShowPasswordForm(true);
            }}
            disabled={busy}
          />
        ) : (
          <View style={authCardStyles.fields}>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <AuthField
                  ref={emailRef}
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
                  editable={!busy}
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
                  editable={!busy}
                  onSubmitEditing={onPasswordSubmit}
                  error={errors.confirmPassword?.message}
                />
              )}
            />
            <AuthContinueButton
              label={t("auth.acceptInviteComplete")}
              onPress={onPasswordSubmit}
              loading={isSubmitting}
              disabled={socialBusy}
            />
          </View>
        )}

        {formError ? (
          <Text style={authCardStyles.formError} accessibilityRole="alert">
            {formError}
          </Text>
        ) : null}

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
      </View>
    </AuthExperienceShell>
  );
}

const styles = StyleSheet.create({
  chooseLabel: {
    ...typography.caption,
    color: authBrand.fieldLabel,
    fontWeight: "600",
    letterSpacing: 0.4,
    marginBottom: -spacing.sm,
  },
  socialBlock: {
    gap: spacing.lg,
  },
});
