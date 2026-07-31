import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { authService } from "@/services/auth/authService";
import { useAuthStore } from "@/store/authStore";
import { useUserStore } from "@/store/userStore";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { navigateAfterAuth } from "@/utils/postAuthNavigation";
import { resolveLoginLocale } from "@/utils/resolveLoginLocale";
import { hapticLight } from "@/utils/haptics";
import { authCardStyles } from "@/components/auth/authCardStyles";
import { authBrand } from "@/theme/authBrand";
import { colors, spacing, typography } from "@/theme";

export function VerifyEmailScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { user, isAuthenticated } = useAuth();
  const params = useLocalSearchParams<{ token?: string; pendingEmail?: string }>();
  const token = typeof params.token === "string" ? params.token.trim() : "";
  const pendingEmail =
    typeof params.pendingEmail === "string"
      ? params.pendingEmail
      : user?.email ?? "";

  const [status, setStatus] = useState<"idle" | "verifying" | "verified" | "error">(
    token ? "verifying" : "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [resendBusy, setResendBusy] = useState(false);

  const refreshAndContinue = useCallback(async () => {
    try {
      const session = await authService.refreshSession();
      if (session?.user) {
        useUserStore.getState().setUser(session.user);
        useAuthStore.getState().setAuthenticated(session.token);
        await navigateAfterAuth(router, session.user);
        return;
      }
    } catch {
      /* fall through to login */
    }
    router.replace("/(auth)/login");
  }, [router]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void authService
      .verifyEmailWithToken(token)
      .then(async (result) => {
        if (cancelled) return;
        setStatus("verified");
        setMessage(result.message || t("auth.verifyEmailSuccess"));
        await refreshAndContinue();
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(friendlyErrorMessage(error, t("auth.verifyEmailFailed"), t));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshAndContinue, t, token]);

  const handleResend = async () => {
    if (!isAuthenticated && !password.trim()) {
      setMessage(t("auth.verifyEmailPasswordRequired"));
      return;
    }
    setResendBusy(true);
    setMessage(null);
    try {
      const locale = resolveLoginLocale();
      const result = isAuthenticated
        ? await authService.resendVerificationEmailSession(locale)
        : await authService.resendVerificationEmail(pendingEmail, password, locale);
      setMessage(result.message || t("auth.verifyEmailResent"));
    } catch (error) {
      setMessage(friendlyErrorMessage(error, t("auth.verifyEmailResendFailed"), t));
    } finally {
      setResendBusy(false);
    }
  };

  return (
    <AuthExperienceShell showSecondaryActions={false}>
      <View style={authCardStyles.formBlock}>
        <View style={authCardStyles.cardHeader}>
          <Text style={authCardStyles.cardEyebrow}>{t("auth.security")}</Text>
          <Text style={authCardStyles.cardTitle}>{t("auth.verifyEmailTitle")}</Text>
          <Text style={authCardStyles.cardSubtitle}>
            {pendingEmail
              ? t("auth.verifyEmailSubtitle", { email: pendingEmail })
              : t("auth.verifyEmailSubtitleGeneric")}
          </Text>
        </View>

        {status === "verifying" ? (
          <Text style={styles.status}>{t("auth.verifyEmailWorking")}</Text>
        ) : null}

        {status === "verified" ? (
          <Text style={styles.success}>{message ?? t("auth.verifyEmailSuccess")}</Text>
        ) : null}

        {status === "error" && message ? (
          <Text style={authCardStyles.formError} accessibilityRole="alert">
            {message}
          </Text>
        ) : null}

        {status !== "verifying" && status !== "verified" ? (
          <>
            {!isAuthenticated ? (
              <AuthField
                label={t("auth.password")}
                icon="lock-closed-outline"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                autoComplete="password"
                editable={!resendBusy}
              />
            ) : null}

            <AuthContinueButton
              label={t("auth.resendVerification")}
              onPress={() => void handleResend()}
              loading={resendBusy}
            />

            {message && status === "idle" ? (
              <Text style={styles.status}>{message}</Text>
            ) : null}
          </>
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
  status: {
    ...typography.body,
    color: authBrand.muted,
    marginBottom: spacing.md,
  },
  success: {
    ...typography.body,
    color: colors.success,
    fontWeight: "600",
    marginBottom: spacing.md,
  },
});
