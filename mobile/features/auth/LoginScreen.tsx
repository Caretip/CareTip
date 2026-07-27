import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { BrandMark } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { loginSchema, type LoginFormValues } from "@/features/auth/loginSchema";
import { isMfaChallenge } from "@/types/auth";
import { getDashboardRouteForRole } from "@/utils/routing";
import { friendlyErrorMessage } from "@/utils/friendlyError";
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
      setFormError(friendlyErrorMessage(error, t("auth.signInFailed")));
    }
  });

  const bootstrapping = !isHydrated || status === "bootstrapping";

  return (
    <Screen contentContainerStyle={styles.content} scrollEnabled={false}>
      <View style={styles.hero}>
        <BrandMark height={40} />
        <Text style={styles.eyebrow}>{t("auth.welcomeBack")}</Text>
        <Text style={styles.title}>{t("auth.signIn")}</Text>
        <Text style={styles.subtitle}>{t("auth.signInSubtitle")}</Text>
      </View>

      <View style={styles.form}>
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

        {formError ? (
          <Text style={styles.formError} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {formError}
          </Text>
        ) : null}

        <Button
          label={t("auth.signIn")}
          onPress={onSubmit}
          loading={isSubmitting}
          disabled={bootstrapping}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: "center",
    gap: spacing["3xl"],
  },
  hero: {
    gap: spacing.sm,
  },
  eyebrow: {
    ...typography.overline,
    color: colors.mutedForeground,
  },
  title: {
    ...typography.hero,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  form: {
    gap: spacing.lg,
  },
  formError: {
    ...typography.caption,
    color: colors.destructive,
    fontWeight: "600",
  },
});
