import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { AuthScreenHeader } from "@/components/auth/AuthScreenHeader";
import { useI18n } from "@/hooks/useI18n";
import { managerRegisterSchema, type ManagerRegisterFormValues } from "@/features/auth/authSchemas";
import { authService } from "@/services/auth/authService";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";
import { hapticLight } from "@/utils/haptics";
import { authCardStyles } from "@/components/auth/authCardStyles";
import { authBrand } from "@/theme/authBrand";
import { spacing, touchTarget, typography } from "@/theme";

/**
 * Manager / business registration only.
 * Employees do not register here — they complete an invitation via AcceptInviteScreen.
 */
export function RegisterScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ role?: string; inviteCode?: string; businessName?: string }>();
  const [formError, setFormError] = useState<string | null>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

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
      name: "",
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

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const created = await authService.register({
        email: values.email.trim(),
        password: values.password,
        name: values.name?.trim() || undefined,
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

        <View style={authCardStyles.fields}>
          <Controller
            control={control}
            name="name"
            render={({ field: { onChange, onBlur, value } }) => (
              <AuthField
                label={t("auth.fullName")}
                icon="person-outline"
                value={value ?? ""}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder={t("auth.fullNamePlaceholder")}
                autoComplete="name"
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
                editable={!isSubmitting}
              />
            )}
          />

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
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!isSubmitting}
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
                editable={!isSubmitting}
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
                editable={!isSubmitting}
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
        />

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            hapticLight();
            router.replace("/(auth)/join");
          }}
          style={({ pressed }) => [styles.inviteRow, pressed ? authCardStyles.pressed : null]}
        >
          <Text style={styles.invitePrompt}>{t("auth.haveInvitePrompt")} </Text>
          <Text style={styles.inviteLink}>{t("auth.haveInviteLink")}</Text>
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
  inviteRow: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xs,
    flexWrap: "wrap",
  },
  invitePrompt: {
    ...typography.body,
    color: authBrand.heroSubtitle,
  },
  inviteLink: {
    ...typography.body,
    color: authBrand.orange,
    fontWeight: "700",
  },
  signInRow: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
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
