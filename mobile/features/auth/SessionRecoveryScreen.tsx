import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { authCardStyles } from "@/components/auth/authCardStyles";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { sessionManager } from "@/services/auth/sessionManager";
import { getUserSnapshot } from "@/services/auth/tokenStorage";
import { useAuthStore } from "@/store/authStore";
import { authBrand } from "@/theme/authBrand";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";

/**
 * Phase 2.4 — offline / timeout session recovery.
 * Secrets may remain in SecureStore for retry; authenticated shell must not mount.
 */
export function SessionRecoveryScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const status = useAuthStore((s) => s.status);
  const [hintEmail, setHintEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getUserSnapshot().then((snap) => {
      setHintEmail(snap?.email ?? null);
    });
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/");
    } else if (status === "unauthenticated") {
      router.replace("/(auth)/login");
    }
  }, [status, router]);

  const handleRetry = useCallback(async () => {
    setBusy(true);
    try {
      await sessionManager.retryBootstrapSession();
    } finally {
      setBusy(false);
    }
  }, []);

  const handleSignIn = useCallback(async () => {
    setBusy(true);
    try {
      await sessionManager.abandonSessionRecovery();
      router.replace("/(auth)/login");
    } finally {
      setBusy(false);
    }
  }, [router]);

  return (
    <AuthExperienceShell showSecondaryActions={false}>
      <View style={authCardStyles.formBlock}>
        <View style={authCardStyles.cardHeader}>
          <Text style={authCardStyles.cardEyebrow}>{t("auth.sessionRecoveryEyebrow")}</Text>
          <Text style={authCardStyles.cardTitle}>{t("auth.sessionRecoveryTitle")}</Text>
          <Text style={authCardStyles.cardSubtitle}>{t("auth.sessionRecoverySubtitle")}</Text>
          {hintEmail ? <Text style={styles.emailHint}>{hintEmail}</Text> : null}
        </View>

        <AuthContinueButton
          label={t("auth.sessionRecoveryRetry")}
          onPress={() => void handleRetry()}
          loading={busy}
          disabled={busy}
        />
        <Pressable
          onPress={() => !busy && void handleSignIn()}
          disabled={busy}
          style={({ pressed }) => [styles.secondaryPress, pressed ? styles.pressed : null]}
        >
          <Text style={styles.secondaryLink}>{t("auth.sessionRecoverySignIn")}</Text>
        </Pressable>
      </View>
    </AuthExperienceShell>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    emailHint: {
      ...typography.caption,
      color: colors.mutedForeground,
      marginTop: spacing.sm,
    },
    secondaryPress: {
      marginTop: spacing.lg,
      alignItems: "center",
      paddingVertical: spacing.sm,
    },
    pressed: {
      opacity: 0.7,
    },
    secondaryLink: {
      ...typography.body,
      color: authBrand.orange,
      textAlign: "center",
      fontWeight: "600",
    },
  });
}
