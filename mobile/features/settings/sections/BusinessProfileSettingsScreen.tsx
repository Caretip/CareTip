import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";
import { SettingsSectionLayout } from "@/features/settings/SettingsSectionLayout";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { fetchBusinessProfile, patchBusinessProfile } from "@/services/api/businessService";
import { queryKeys, queryStaleTimes } from "@/services/api/queryClient";
import { showErrorToast, showSuccessToast } from "@/store/toastStore";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { ColorPalette } from "@/theme/colors";
import { radius, spacing, typography } from "@/theme";
import { textA11y } from "@/theme/a11y";

export function BusinessProfileSettingsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: queryKeys.businessProfile,
    queryFn: fetchBusinessProfile,
    staleTime: queryStaleTimes.profile,
  });
  const profile = profileQuery.data;

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [website, setWebsite] = useState("");

  useEffect(() => {
    if (!profile) return;
    setName(String(profile.businessName ?? profile.name ?? ""));
    setLocation(String(profile.location ?? ""));
    setContactPhone(String(profile.contactPhone ?? ""));
    setWebsite(String(profile.website ?? ""));
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: () =>
      patchBusinessProfile({
        name: name.trim(),
        legalBusinessName: name.trim(),
        location: location.trim() || null,
        contactPhone: contactPhone.trim() || null,
        website: website.trim() || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.businessProfile });
      showSuccessToast(t("settings.profileSaved"));
    },
    onError: (error) => {
      showErrorToast(friendlyErrorMessage(error, t("settings.saveError"), t));
    },
  });

  return (
    <SettingsSectionLayout
      title={t("settings.menu.businessProfile")}
      subtitle={t("settings.menu.businessProfileDesc")}
      keyboardAware
    >
      <Section title={t("settings.menu.venueDetails")}>
        <Field
          label={t("settings.menu.businessName")}
          value={name}
          onChangeText={setName}
          editable={!saveMutation.isPending}
          styles={styles}
          placeholderColor={colors.mutedForeground}
        />
        <Field
          label={t("settings.menu.location")}
          value={location}
          onChangeText={setLocation}
          editable={!saveMutation.isPending}
          styles={styles}
          placeholderColor={colors.mutedForeground}
        />
        <Field
          label={t("settings.menu.contactPhone")}
          value={contactPhone}
          onChangeText={setContactPhone}
          keyboardType="phone-pad"
          editable={!saveMutation.isPending}
          styles={styles}
          placeholderColor={colors.mutedForeground}
        />
        <Field
          label={t("settings.menu.website")}
          value={website}
          onChangeText={setWebsite}
          autoCapitalize="none"
          keyboardType="url"
          editable={!saveMutation.isPending}
          styles={styles}
          placeholderColor={colors.mutedForeground}
        />
        <Text style={styles.readOnlyLabel}>{t("settings.menu.timezone")}</Text>
        <Text style={styles.readOnlyValue}>{profile?.timezone ?? "—"}</Text>
      </Section>
      <Button
        label={t("common.save")}
        loading={saveMutation.isPending}
        disabled={!name.trim() || saveMutation.isPending}
        onPress={() => void saveMutation.mutateAsync()}
      />
    </SettingsSectionLayout>
  );
}

function Field({
  label,
  value,
  onChangeText,
  editable = true,
  keyboardType,
  autoCapitalize,
  styles,
  placeholderColor,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  editable?: boolean;
  keyboardType?: "default" | "phone-pad" | "url";
  autoCapitalize?: "none" | "sentences";
  styles: ReturnType<typeof createStyles>;
  placeholderColor: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={styles.input}
        placeholderTextColor={placeholderColor}
        {...textA11y}
      />
    </View>
  );
}

export function BusinessIntegrationsSettingsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <SettingsSectionLayout
      title={t("settings.menu.integrations")}
      subtitle={t("settings.menu.integrationsDesc")}
    >
      <Section>
        <Text style={styles.readOnlyValue}>{t("settings.menu.integrationsComingSoon")}</Text>
      </Section>
    </SettingsSectionLayout>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    field: {
      gap: spacing.xs,
      marginBottom: spacing.md,
    },
    label: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontWeight: "600",
    },
    input: {
      ...typography.body,
      color: colors.foreground,
      backgroundColor: colors.secondary,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      minHeight: 48,
    },
    readOnlyLabel: {
      ...typography.caption,
      color: colors.mutedForeground,
      marginTop: spacing.sm,
    },
    readOnlyValue: {
      ...typography.body,
      color: colors.foreground,
      fontWeight: "600",
    },
  });
}
