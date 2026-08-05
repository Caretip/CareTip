import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MediaUploadControl } from "@/components/media/MediaUploadControl";
import { Button } from "@/components/ui/Button";
import { RemoteAvatar } from "@/components/ui/RemoteAvatar";
import { TextField } from "@/components/ui/TextField";
import { Section } from "@/components/ui/Section";
import { SettingsSectionLayout } from "@/features/settings/SettingsSectionLayout";
import { useI18n } from "@/hooks/useI18n";
import { useMediaUploadFlow } from "@/hooks/useMediaUploadFlow";
import { useTheme } from "@/hooks/useTheme";
import { fetchEmployeeProfile } from "@/services/api/employeeService";
import { patchEmployeeProfile } from "@/services/api/settingsService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { showErrorToast, showSuccessToast } from "@/store/toastStore";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import { requireOnline } from "@/utils/requireOnline";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";

export function EmployeeProfileSettingsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const queryClient = useQueryClient();
  const { uploading: avatarUploading, startUpload: startAvatarUpload } =
    useMediaUploadFlow("employeeAvatar");
  const employeeQuery = useQuery({
    queryKey: keys.employeeMe,
    queryFn: fetchEmployeeProfile,
    enabled: Boolean(userId),
    staleTime: queryStaleTimes.profile,
  });
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [monthlyGoal, setMonthlyGoal] = useState("");

  useEffect(() => {
    if (!employeeQuery.data) return;
    setName(employeeQuery.data.name ?? "");
    setBio(employeeQuery.data.bio ?? "");
    setMonthlyGoal(
      employeeQuery.data.monthlyGoal != null ? String(employeeQuery.data.monthlyGoal) : "",
    );
  }, [employeeQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!(await requireOnline())) {
        throw new Error("OFFLINE");
      }
      return patchEmployeeProfile({
        name: name.trim(),
        bio: bio.trim() || null,
        monthlyGoal: monthlyGoal.trim() ? Number(monthlyGoal) : null,
      });
    },
    onSuccess: () => {
      showSuccessToast(t("success.saved"));
      void queryClient.invalidateQueries({ queryKey: keys.employeeMe });
      void queryClient.invalidateQueries({ queryKey: keys.employeeTips });
    },
    onError: (error) => {
      if (error instanceof Error && error.message === "OFFLINE") {
        showErrorToast(t("errors.offline"));
        return;
      }
      showErrorToast(friendlyErrorMessage(error, t("settings.saveError"), t));
    },
  });

  return (
    <SettingsSectionLayout
      title={t("settings.menu.profile")}
      subtitle={t("settings.menu.profileDesc")}
      keyboardAware
    >
      <Section title={t("settings.profileTitle")}>
        <MediaUploadControl
          preview={
            <RemoteAvatar
              displayName={name || employeeQuery.data?.name || "?"}
              uri={employeeQuery.data?.avatar}
              size={72}
              tone="brand"
              cacheBust={employeeQuery.dataUpdatedAt}
            />
          }
          actionLabel={t("settings.media.changeAvatar")}
          uploadingLabel={t("settings.media.uploading")}
          hint={t("settings.media.avatarHint")}
          uploading={avatarUploading}
          disabled={saveMutation.isPending}
          onPress={() => void startAvatarUpload()}
        />
        <View style={styles.meta}>
          <Text style={styles.muted}>{employeeQuery.data?.jobTitle}</Text>
          <Text style={styles.muted}>{employeeQuery.data?.businessName}</Text>
        </View>
      </Section>
      <TextField
        label={t("settings.menu.displayName")}
        value={name}
        onChangeText={setName}
        editable={!saveMutation.isPending && !avatarUploading}
      />
      <TextField
        label={t("settings.menu.bio")}
        value={bio}
        onChangeText={setBio}
        multiline
        editable={!saveMutation.isPending && !avatarUploading}
      />
      <TextField
        label={t("settings.menu.monthlyGoal")}
        value={monthlyGoal}
        onChangeText={setMonthlyGoal}
        keyboardType="decimal-pad"
        editable={!saveMutation.isPending && !avatarUploading}
      />
      <Button
        label={t("common.save")}
        onPress={() => void saveMutation.mutate()}
        loading={saveMutation.isPending}
        disabled={avatarUploading}
      />
    </SettingsSectionLayout>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    meta: {
      gap: spacing.xxs,
      marginBottom: spacing.sm,
    },
    muted: { ...typography.body, color: colors.mutedForeground },
  });
}
