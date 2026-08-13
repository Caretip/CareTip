import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Image, Platform, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Section } from "@/components/ui/Section";
import { SettingsSectionLayout } from "@/features/settings/SettingsSectionLayout";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import {
  changePassword,
  disableTwoFactor,
  enableTwoFactor,
  fetchTwoFactorStatus,
  setupTwoFactor,
} from "@/services/api/settingsService";
import {
  isAppleSignInAvailable,
  isAppleSignInConfigured,
  logAppleOAuthDiag,
  mapAppleNativeError,
  requestAppleIdToken,
} from "@/services/apple/appleSignIn";
import {
  isFacebookSignInConfigured,
  mapFacebookNativeError,
  requestFacebookIdToken,
} from "@/services/facebook/facebookSignIn";
import {
  isGoogleSignInConfigured,
  isGoogleSignInNativeAvailable,
  mapGoogleNativeError,
  requestGoogleIdToken,
} from "@/services/google/googleSignIn";
import {
  linkOAuthAccount,
  listOAuthAccounts,
  unlinkOAuthAccount,
} from "@/services/auth/authService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { showErrorToast, showSuccessToast } from "@/store/toastStore";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { resolveOAuthErrorMessage } from "@/utils/oauthErrorMessage";
import type { OAuthProvider } from "@/types/auth";
import type { TwoFactorSetup } from "@/types/settings";
import type { ColorPalette } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme";

type SecuritySettingsSectionProps = {
  includeMfa?: boolean;
};

const ALL_PROVIDERS: OAuthProvider[] =
  Platform.OS === "ios" ? ["apple", "google", "facebook"] : ["google", "facebook", "apple"];

function providerLabelKey(provider: OAuthProvider): string {
  if (provider === "apple") return "settings.linkedAccounts.apple";
  if (provider === "facebook") return "settings.linkedAccounts.facebook";
  return "settings.linkedAccounts.google";
}

async function requestIdTokenForProvider(provider: OAuthProvider): Promise<string> {
  if (provider === "google") return requestGoogleIdToken();
  if (provider === "apple") {
    const result = await requestAppleIdToken();
    return result.idToken;
  }
  return requestFacebookIdToken();
}

function mapProviderNativeError(provider: OAuthProvider, error: unknown): Error {
  if (provider === "google") return mapGoogleNativeError(error);
  if (provider === "apple") return mapAppleNativeError(error);
  return mapFacebookNativeError(error);
}

export function SecuritySettingsSection({ includeMfa = false }: SecuritySettingsSectionProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSetup, setMfaSetup] = useState<TwoFactorSetup | null>(null);
  const [mfaSetupLoading, setMfaSetupLoading] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<OAuthProvider | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(() =>
    Platform.OS === "android" ? isAppleSignInConfigured() : false,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const available = await isAppleSignInAvailable();
        if (!cancelled) setAppleAvailable(available);
      } catch {
        if (!cancelled) setAppleAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const twoFactorQuery = useQuery({
    queryKey: keys.twoFactor,
    queryFn: fetchTwoFactorStatus,
    enabled: includeMfa && Boolean(userId),
    staleTime: queryStaleTimes.settings,
  });

  const oauthQuery = useQuery({
    queryKey: keys.oauthAccounts,
    queryFn: listOAuthAccounts,
    enabled: Boolean(userId),
    staleTime: queryStaleTimes.settings,
  });

  const unlinkMutation = useMutation({
    mutationFn: unlinkOAuthAccount,
    onSuccess: async () => {
      showSuccessToast(t("settings.linkedAccounts.unlinked"));
      await queryClient.invalidateQueries({ queryKey: keys.oauthAccounts });
    },
    onError: (e) => {
      showErrorToast(friendlyErrorMessage(e, t("settings.linkedAccounts.unlinkError"), t));
    },
  });

  const isProviderLinkable = useCallback(
    (provider: OAuthProvider): boolean => {
      if (provider === "google") {
        return isGoogleSignInConfigured() && isGoogleSignInNativeAvailable();
      }
      if (provider === "apple") {
        return isAppleSignInConfigured() && appleAvailable;
      }
      return isFacebookSignInConfigured();
    },
    [appleAvailable],
  );

  const handleChangePassword = async () => {
    try {
      await changePassword(currentPassword, newPassword);
      showSuccessToast(t("success.saved"));
      setCurrentPassword("");
      setNewPassword("");
      await queryClient.invalidateQueries({ queryKey: keys.oauthAccounts });
    } catch (e) {
      showErrorToast(friendlyErrorMessage(e, t("settings.passwordError"), t));
    }
  };

  const handleStartMfaSetup = async () => {
    setMfaSetupLoading(true);
    try {
      setMfaSetup(await setupTwoFactor());
    } catch (e) {
      showErrorToast(friendlyErrorMessage(e, t("settings.setupError"), t));
    } finally {
      setMfaSetupLoading(false);
    }
  };

  const handleEnableMfa = async () => {
    if (!mfaCode.trim()) {
      Alert.alert(t("settings.codeRequiredTitle"), t("settings.codeRequiredBody"));
      return;
    }
    if (!mfaSetup) {
      Alert.alert(t("settings.setupFirstTitle"), t("settings.setupFirstBody"));
      return;
    }
    try {
      await enableTwoFactor(mfaCode);
      showSuccessToast(t("settings.twoFaEnabledBody"));
      setMfaCode("");
      setMfaSetup(null);
      void twoFactorQuery.refetch();
    } catch (e) {
      showErrorToast(friendlyErrorMessage(e, t("settings.enableError"), t));
    }
  };

  const handleDisableMfa = async () => {
    try {
      await disableTwoFactor(mfaCode);
      showSuccessToast(t("settings.twoFaDisabled"));
      setMfaCode("");
      setMfaSetup(null);
      void twoFactorQuery.refetch();
    } catch (e) {
      showErrorToast(friendlyErrorMessage(e, t("settings.disableError"), t));
    }
  };

  const handleLink = async (provider: OAuthProvider) => {
    if (linkingProvider) return;
    if (!isProviderLinkable(provider)) {
      if (provider === "apple") {
        logAppleOAuthDiag("configuration missing");
      }
      showErrorToast(
        provider === "apple"
          ? t("auth.appleNotConfigured")
          : provider === "facebook"
            ? t("auth.facebookNotConfigured")
            : t("auth.googleNotConfigured"),
      );
      return;
    }
    setLinkingProvider(provider);
    try {
      const idToken = await requestIdTokenForProvider(provider);
      if (provider === "apple" && (typeof idToken !== "string" || !idToken.trim())) {
        throw new Error("Apple did not return an identity token.");
      }
      await linkOAuthAccount(provider, idToken);
      showSuccessToast(t("settings.linkedAccounts.linked"));
      await queryClient.invalidateQueries({ queryKey: keys.oauthAccounts });
    } catch (error) {
      const mapped = mapProviderNativeError(provider, error);
      showErrorToast(resolveOAuthErrorMessage(mapped, t, provider));
    } finally {
      setLinkingProvider(null);
    }
  };

  const handleUnlink = (provider: OAuthProvider) => {
    Alert.alert(
      t("settings.linkedAccounts.unlinkTitle"),
      t("settings.linkedAccounts.unlinkBody", {
        provider: t(providerLabelKey(provider)),
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.linkedAccounts.unlinkConfirm"),
          style: "destructive",
          onPress: () => unlinkMutation.mutate(provider),
        },
      ],
    );
  };

  const linkedSet = useMemo(() => {
    const set = new Set<OAuthProvider>();
    for (const row of oauthQuery.data?.providers ?? []) {
      set.add(row.provider);
    }
    return set;
  }, [oauthQuery.data?.providers]);

  const canUnlinkAny = useMemo(() => {
    const linkedCount = linkedSet.size;
    const hasPassword = Boolean(oauthQuery.data?.hasPassword);
    return hasPassword || linkedCount > 1;
  }, [linkedSet.size, oauthQuery.data?.hasPassword]);

  return (
    <SettingsSectionLayout
      title={t("settings.menu.security")}
      subtitle={t("settings.passwordSecuritySub")}
      keyboardAware
    >
      <Section title={t("settings.passwordSecurity")}>
        <TextField
          label={t("settings.currentPassword")}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
        />
        <TextField
          label={t("settings.newPassword")}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
        />
        <Button
          label={t("settings.changePassword")}
          variant="secondary"
          onPress={() => void handleChangePassword()}
        />
      </Section>

      <Section title={t("settings.linkedAccounts.title")}>
        <Text style={styles.body}>{t("settings.linkedAccounts.subtitle")}</Text>
        {oauthQuery.isLoading && !oauthQuery.data ? (
          <Text style={styles.muted}>{t("common.loading")}</Text>
        ) : null}
        {oauthQuery.isError ? (
          <Text style={styles.body}>{t("settings.linkedAccounts.loadError")}</Text>
        ) : null}
        {ALL_PROVIDERS.map((provider) => {
          const linked = linkedSet.has(provider);
          const linkable = isProviderLinkable(provider);
          if (!linked && !linkable) return null;
          return (
            <View key={provider} style={styles.providerRow}>
              <View style={styles.providerMeta}>
                <Text style={styles.providerName}>{t(providerLabelKey(provider))}</Text>
                <Text style={styles.muted}>
                  {linked
                    ? t("settings.linkedAccounts.linkedStatus")
                    : t("settings.linkedAccounts.notLinkedStatus")}
                </Text>
              </View>
              {linked ? (
                <Button
                  label={t("settings.linkedAccounts.unlink")}
                  variant="ghost"
                  disabled={!canUnlinkAny || unlinkMutation.isPending}
                  onPress={() => handleUnlink(provider)}
                />
              ) : (
                <Button
                  label={
                    linkingProvider === provider
                      ? t("common.loading")
                      : t("settings.linkedAccounts.link")
                  }
                  variant="secondary"
                  disabled={linkingProvider != null}
                  onPress={() => void handleLink(provider)}
                />
              )}
            </View>
          );
        })}
      </Section>

      {includeMfa ? (
        <Section title={t("settings.menu.twoFactor")}>
          <Text style={styles.body}>
            {t("settings.twoFactor", {
              status: twoFactorQuery.data?.enabled ? t("settings.enabled") : t("settings.disabled"),
            })}
          </Text>
          {!twoFactorQuery.data?.enabled && !mfaSetup ? (
            <Button
              label={mfaSetupLoading ? t("settings.preparing") : t("settings.setupAuthenticator")}
              variant="secondary"
              onPress={() => void handleStartMfaSetup()}
              disabled={mfaSetupLoading}
            />
          ) : null}
          {mfaSetup?.qrDataUrl ? (
            <View style={styles.mfaQr}>
              <Text style={styles.body}>{t("settings.scanQr")}</Text>
              <Image
                source={{ uri: mfaSetup.qrDataUrl }}
                style={styles.mfaQrImage}
                accessibilityLabel={t("auth.qrA11y")}
              />
            </View>
          ) : null}
          <TextField
            label={t("settings.authenticatorCode")}
            value={mfaCode}
            onChangeText={setMfaCode}
            keyboardType="number-pad"
          />
          <Button label={t("settings.enable2fa")} onPress={() => void handleEnableMfa()} />
          <Button label={t("settings.disable2fa")} variant="ghost" onPress={() => void handleDisableMfa()} />
        </Section>
      ) : null}
    </SettingsSectionLayout>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    body: { ...typography.body, color: colors.foreground },
    muted: { ...typography.caption, color: colors.mutedForeground },
    providerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      paddingVertical: spacing.xs,
    },
    providerMeta: { flex: 1, gap: 2 },
    providerName: { ...typography.body, color: colors.foreground, fontWeight: "600" },
    mfaQr: { gap: spacing.sm, alignItems: "center" },
    mfaQrImage: { width: 200, height: 200, borderRadius: radius.xl },
  });
}
