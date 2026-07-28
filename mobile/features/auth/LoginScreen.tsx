import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthGlassCard } from "@/components/auth/AuthGlassCard";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { loginSchema, type LoginFormValues } from "@/features/auth/loginSchema";
import { authWebPaths } from "@/constants/authLinks";
import { isMfaChallenge } from "@/types/auth";
import { getDashboardRouteForRole } from "@/utils/routing";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { openCareTipWeb } from "@/utils/openCareTipWeb";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";
import { colors, spacing, typography } from "@/theme";

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

  useEffect(() => {
    if (isHydrated && isAuthenticated && user?.role) {
      router.replace(getDashboardRouteForRole(user.role));
    }
  }, [isHydrated, isAuthenticated, user?.role, router]);

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

      router.replace(getDashboardRouteForRole(result.user.role));
    } catch (error) {
      setFormError(friendlyErrorMessage(error, t("auth.signInFailed"), t));
    }
  });

  const bootstrapping = !isHydrated || status === "bootstrapping";

  return (
    <AuthExperienceShell>
      <AuthGlassCard>
        <View style={styles.cardHeader}>
          <Text style={styles.cardEyebrow}>{t("auth.welcomeBack")}</Text>
          <Text style={styles.cardTitle}>{t("auth.loginTitle")}</Text>
        </View>

        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextField
              label={t("auth.email")}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
              error={errors.email?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextField
              label={t("auth.password")}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              secureTextEntry
              textContentType="password"
              autoComplete="password"
              error={errors.password?.message}
            />
          )}
        />

        <Pressable
          accessibilityRole="button"
          onPress={() => void openCareTipWeb(authWebPaths.forgotPassword)}
          style={({ pressed }) => [styles.forgotLink, pressed ? styles.pressed : null]}
        >
          <Text style={styles.forgotLabel}>{t("auth.forgotPassword")}</Text>
        </Pressable>

        {formError ? (
          <Text style={styles.formError} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {formError}
          </Text>
        ) : null}

        <Button
          label={t("common.continue")}
          onPress={onSubmit}
          loading={isSubmitting}
          disabled={bootstrapping}
        />
      </AuthGlassCard>
    </AuthExperienceShell>
  );
}

const styles = StyleSheet.create({
  cardHeader: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  cardEyebrow: {
    ...typography.overline,
    color: colors.primary,
  },
  cardTitle: {
    ...typography.h1,
    color: colors.foreground,
    fontSize: 26,
  },
  forgotLink: {
    alignSelf: "flex-end",
    marginTop: -spacing.sm,
    minHeight: 44,
    justifyContent: "center",
  },
  forgotLabel: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: "700",
  },
  formError: {
    ...typography.caption,
    color: colors.destructive,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.75,
  },
});
