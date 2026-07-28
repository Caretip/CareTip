import { useEffect, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { Alert, Image, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { Section, GroupedList, GroupedRow, Divider } from "@/components/ui/Section";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import {
  changePassword,
  disableTwoFactor,
  enableTwoFactor,
  fetchAccountSettings,
  fetchTwoFactorStatus,
  patchAccountSettings,
  patchEmployeeProfile,
  setupTwoFactor,
} from "@/services/api/settingsService";
import { fetchBusinessProfile } from "@/services/api/businessService";
import { fetchEmployeeProfile } from "@/services/api/employeeService";
import { saveUserSnapshot } from "@/services/auth/tokenStorage";
import { queryKeys } from "@/services/api/queryClient";
import { config } from "@/constants/config";
import { useUserStore } from "@/store/userStore";
import { formatUserRole } from "@/utils/labels";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { TwoFactorSetup } from "@/types/settings";
import type { AppLocale } from "@/types/auth";
import { colors, radius, spacing, typography } from "@/theme";

type SettingsScreenProps = {
  role: "business" | "employee";
};

export function SettingsScreen({ role }: SettingsScreenProps) {
  const router = useRouter();
  const { t, setLanguage } = useI18n();
  const { user, signOut } = useAuth();
  const setUser = useUserStore((s) => s.setUser);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSetup, setMfaSetup] = useState<TwoFactorSetup | null>(null);
  const [mfaSetupLoading, setMfaSetupLoading] = useState(false);
  const [localeSaving, setLocaleSaving] = useState(false);

  const accountQuery = useQuery({
    queryKey: queryKeys.accountSettings,
    queryFn: fetchAccountSettings,
    enabled: true,
  });

  const twoFactorQuery = useQuery({
    queryKey: queryKeys.twoFactor,
    queryFn: fetchTwoFactorStatus,
    enabled: role === "business",
  });

  const employeeQuery = useQuery({
    queryKey: queryKeys.employeeMe,
    queryFn: fetchEmployeeProfile,
    enabled: role === "employee",
  });

  const businessQuery = useQuery({
    queryKey: queryKeys.businessProfile,
    queryFn: fetchBusinessProfile,
    enabled: role === "business",
  });

  const patchAccount = useMutation({
    mutationFn: patchAccountSettings,
    onSuccess: () => void accountQuery.refetch(),
  });

  const patchEmployee = useMutation({
    mutationFn: patchEmployeeProfile,
    onSuccess: () => void employeeQuery.refetch(),
  });

  const [locale, setLocale] = useState<AppLocale>(
    user?.preferredLocale === "de" ? "de" : "en",
  );

  useEffect(() => {
    const fromAccount = accountQuery.data?.preferredLocale;
    if (fromAccount === "de" || fromAccount === "en") {
      setLocale(fromAccount);
      return;
    }
    if (user?.preferredLocale === "de" || user?.preferredLocale === "en") {
      setLocale(user.preferredLocale);
    }
  }, [accountQuery.data?.preferredLocale, user?.preferredLocale]);

  const openLegal = async (path: string) => {
    const base = config.appUrl || "https://caretip.de";
    await WebBrowser.openBrowserAsync(`${base}${path}`);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  const handleLocaleChange = async (next: AppLocale) => {
    if (next === locale || localeSaving) return;
    const previous = locale;
    setLocale(next);
    setLocaleSaving(true);
    try {
      await setLanguage(next);
      await patchAccount.mutateAsync({ preferredLocale: next });
      if (user) {
        const updated = { ...user, preferredLocale: next };
        setUser(updated);
        await saveUserSnapshot(updated);
      }
    } catch (e) {
      setLocale(previous);
      await setLanguage(previous);
      Alert.alert(t("common.error"), friendlyErrorMessage(e, t("settings.languageError"), t));
    } finally {
      setLocaleSaving(false);
    }
  };

  const handleChangePassword = async () => {
    try {
      await changePassword(currentPassword, newPassword);
      Alert.alert(t("settings.passwordUpdatedTitle"), t("settings.passwordUpdatedBody"));
      setCurrentPassword("");
      setNewPassword("");
    } catch (e) {
      Alert.alert(t("common.error"), friendlyErrorMessage(e, t("settings.passwordError"), t));
    }
  };

  const handleStartMfaSetup = async () => {
    setMfaSetupLoading(true);
    try {
      const setup = await setupTwoFactor();
      setMfaSetup(setup);
    } catch (e) {
      Alert.alert(t("common.error"), friendlyErrorMessage(e, t("settings.setupError"), t));
    } finally {
      setMfaSetupLoading(false);
    }
  };

  const handleEnableMfa = async () => {
    if (!mfaCode.trim()) {
      Alert.alert(t("settings.codeRequiredTitle"), t("settings.codeRequiredBody"));
      return;
    }
    try {
      if (!mfaSetup) {
        Alert.alert(t("settings.setupFirstTitle"), t("settings.setupFirstBody"));
        return;
      }
      await enableTwoFactor(mfaCode);
      Alert.alert(t("settings.twoFaEnabled"), t("settings.twoFaEnabledBody"));
      setMfaCode("");
      setMfaSetup(null);
      void twoFactorQuery.refetch();
    } catch (e) {
      Alert.alert(t("common.error"), friendlyErrorMessage(e, t("settings.enableError"), t));
    }
  };

  const handleDisableMfa = async () => {
    try {
      await disableTwoFactor(mfaCode);
      Alert.alert(t("settings.twoFaDisabled"));
      setMfaCode("");
      setMfaSetup(null);
      void twoFactorQuery.refetch();
    } catch (e) {
      Alert.alert(t("common.error"), friendlyErrorMessage(e, t("settings.disableError"), t));
    }
  };

  const profileName =
    role === "business"
      ? (businessQuery.data?.businessName ?? businessQuery.data?.name ?? user?.name)
      : (employeeQuery.data?.name ?? user?.name);

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.title}>
          {role === "business" ? t("settings.titleBusiness") : t("settings.titleEmployee")}
        </Text>
        <Text style={styles.subtitle}>{profileName}</Text>
        <Text style={styles.subtitle}>{user?.email}</Text>
      </View>

      <Section title={t("settings.profileTitle")}>
        <Text style={styles.body}>
          {t("settings.role", { role: formatUserRole(user?.role) })}
        </Text>
        {role === "employee" && employeeQuery.data?.jobTitle ? (
          <Text style={styles.body}>{employeeQuery.data.jobTitle}</Text>
        ) : null}
      </Section>

      <Divider />

      <Section title={t("settings.language")}>
        <Text style={styles.caption}>{t("settings.languageSubtitle")}</Text>
        <View style={styles.localeRow}>
          {(["en", "de"] as const).map((code) => {
            const active = locale === code;
            return (
              <Pressable
                key={code}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: localeSaving }}
                disabled={localeSaving}
                onPress={() => void handleLocaleChange(code)}
                style={[styles.localeChip, active ? styles.localeChipActive : null]}
              >
                <Text style={[styles.localeChipLabel, active ? styles.localeChipLabelActive : null]}>
                  {code === "en" ? t("settings.english") : t("settings.german")}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      {role === "business" && accountQuery.data ? (
        <>
          <Divider />
          <Section title={t("settings.notificationsBusiness")}>
            <GroupedList>
              {(
                [
                  ["tipReceivedNotifications", "settings.tipReceived"],
                  ["summaryEmails", "settings.summaryEmails"],
                  ["systemAlerts", "settings.systemAlerts"],
                  ["notifyNewLogin", "settings.newLogin"],
                ] as const
              ).map(([key, labelKey], index, arr) => (
                <GroupedRow key={key} showDivider={index < arr.length - 1}>
                  <View style={styles.row}>
                    <Text style={styles.body}>{t(labelKey)}</Text>
                    <Switch
                      value={accountQuery.data[key]}
                      onValueChange={(value) => void patchAccount.mutateAsync({ [key]: value })}
                    />
                  </View>
                </GroupedRow>
              ))}
            </GroupedList>
          </Section>
        </>
      ) : null}

      {role === "employee" && employeeQuery.data ? (
        <>
          <Divider />
          <Section title={t("settings.notificationsEmployee")}>
            <GroupedList>
              <GroupedRow>
                <View style={styles.row}>
                  <Text style={styles.body}>{t("settings.emailNotifications")}</Text>
                  <Switch
                    value={employeeQuery.data.emailNotifications}
                    onValueChange={(value) =>
                      void patchEmployee.mutateAsync({ emailNotifications: value })
                    }
                  />
                </View>
              </GroupedRow>
              <GroupedRow showDivider={false}>
                <View style={styles.row}>
                  <Text style={styles.body}>{t("settings.pushNotifications")}</Text>
                  <Switch
                    value={employeeQuery.data.pushNotifications}
                    onValueChange={(value) =>
                      void patchEmployee.mutateAsync({ pushNotifications: value })
                    }
                  />
                </View>
              </GroupedRow>
            </GroupedList>
          </Section>
        </>
      ) : null}

      <Divider />

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
        {role === "business" ? (
          <View style={styles.securityBlock}>
            <Text style={styles.body}>
              {t("settings.twoFactor", {
                status: twoFactorQuery.data?.enabled
                  ? t("settings.enabled")
                  : t("settings.disabled"),
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
            <Button
              label={t("settings.disable2fa")}
              variant="ghost"
              onPress={() => void handleDisableMfa()}
            />
          </View>
        ) : null}
      </Section>

      <Divider />

      <Section title={t("settings.legal")}>
        <Button
          label={t("settings.privacy")}
          variant="secondary"
          onPress={() => void openLegal("/privacy")}
        />
        <Button
          label={t("settings.terms")}
          variant="secondary"
          onPress={() => void openLegal("/terms")}
        />
        <Button
          label={t("settings.cookies")}
          variant="secondary"
          onPress={() => void openLegal("/cookies")}
        />
      </Section>

      <Button
        label={t("settings.signOut")}
        variant="destructive"
        onPress={() => void handleSignOut()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: spacing.xs,
    paddingBottom: spacing.xl,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h1,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  caption: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  body: {
    ...typography.body,
    color: colors.foreground,
    flex: 1,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 28,
  },
  localeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  localeChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  localeChipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  localeChipLabel: {
    ...typography.body,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  localeChipLabelActive: {
    color: colors.primary,
  },
  securityBlock: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  mfaQr: {
    gap: spacing.sm,
    alignItems: "center",
  },
  mfaQrImage: {
    width: 200,
    height: 200,
    borderRadius: radius.xl,
  },
});
