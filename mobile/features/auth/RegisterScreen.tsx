import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthGlassCard } from "@/components/auth/AuthGlassCard";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { useI18n } from "@/hooks/useI18n";
import { registerSchema, type RegisterFormValues } from "@/features/auth/authSchemas";
import { authService } from "@/services/auth/authService";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";
import { hapticLight } from "@/utils/haptics";
import { authCardStyles } from "@/components/auth/authCardStyles";
import { authBrand } from "@/theme/authBrand";
import { colors, spacing, touchTarget, typography } from "@/theme";

export function RegisterScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ role?: string; inviteCode?: string; businessName?: string }>();
  const [formError, setFormError] = useState<string | null>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const defaultRole = params.role === "employee" ? "employee" : "business";
  const inviteFromLink = typeof params.inviteCode === "string" ? params.inviteCode : "";
  const venueName = typeof params.businessName === "string" ? params.businessName : "";

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: defaultRole,
      inviteCode: inviteFromLink,
    },
  });

  const role = watch("role");

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (values.role === "employee" && values.inviteCode?.trim()) {
        await authService.validateInviteCode(values.inviteCode.trim());
      }
      const created = await authService.register({
        email: values.email.trim(),
        password: values.password,
        name: values.name?.trim() || undefined,
        role: values.role,
        inviteCode: values.role === "employee" ? values.inviteCode?.trim() : undefined,
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
      <AuthGlassCard>
        <View style={authCardStyles.cardHeader}>
          <Text style={authCardStyles.cardEyebrow}>{t("auth.createAccountTitle")}</Text>
          <Text style={authCardStyles.cardTitle}>{t("auth.registerScreenTitle")}</Text>
          <Text style={authCardStyles.cardSubtitle}>{t("auth.registerScreenSubtitle")}</Text>
        </View>

        {venueName ? (
          <Text style={styles.venueHint}>{t("auth.joinVenueHint", { name: venueName })}</Text>
        ) : null}

        <View style={authCardStyles.roleRow}>
          {(["business", "employee"] as const).map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: role === option }}
              onPress={() => {
                hapticLight();
                setValue("role", option, { shouldValidate: true });
              }}
              style={[authCardStyles.roleChip, role === option ? authCardStyles.roleChipActive : null]}
            >
              <Text style={[authCardStyles.roleChipLabel, role === option ? authCardStyles.roleChipLabelActive : null]}>
                {option === "business" ? t("auth.registerBusiness") : t("auth.registerEmployee")}
              </Text>
            </Pressable>
          ))}
        </View>

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
                autoComplete="name"
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
                editable={!isSubmitting}
              />
            )}
          />

          {role === "employee" ? (
            <Controller
              control={control}
              name="inviteCode"
              render={({ field: { onChange, onBlur, value } }) => (
                <AuthField
                  label={t("auth.inviteCode")}
                  icon="ticket-outline"
                  value={value ?? ""}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  autoCapitalize="characters"
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  editable={!isSubmitting}
                  error={errors.inviteCode?.message}
                />
              )}
            />
          ) : null}

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
          label={t("auth.createAccountCta")}
          onPress={onSubmit}
          loading={isSubmitting}
        />

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
      </AuthGlassCard>
    </AuthExperienceShell>
  );
}

const styles = StyleSheet.create({
  venueHint: {
    ...typography.caption,
    color: colors.success,
    fontWeight: "600",
    marginBottom: spacing.sm,
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
    color: authBrand.muted,
  },
  signInLink: {
    ...typography.body,
    color: authBrand.orange,
    fontWeight: "700",
  },
});
