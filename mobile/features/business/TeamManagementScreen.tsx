import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { RemoteAvatar } from "@/components/ui/RemoteAvatar";
import { Button } from "@/components/ui/Button";
import { DetailScreenHeader } from "@/components/ui/DetailScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { GroupedList, GroupedRow, Section } from "@/components/ui/Section";
import { Screen } from "@/components/ui/Screen";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { fetchBusinessEmployees } from "@/services/api/employeeDirectoryService";
import {
  fetchBusinessProfile,
  generateBusinessInviteCode,
} from "@/services/api/businessService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { copyToClipboard, shareInvite } from "@/services/share";
import { showErrorToast, showSuccessToast } from "@/store/toastStore";
import { formatCount } from "@/utils/format";
import { friendlyErrorMessage } from "@/utils/friendlyError";
import type { ColorPalette } from "@/theme/colors";
import { spacing, typography } from "@/theme";

function formatInviteExpiry(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale.startsWith("de") ? "de-DE" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function TeamManagementScreen() {
  const { t, language } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sharing, setSharing] = useState(false);

  const profileQuery = useQuery({
    queryKey: keys.businessProfile,
    queryFn: fetchBusinessProfile,
    enabled: Boolean(userId),
    staleTime: queryStaleTimes.profile,
  });

  const businessId = user?.businessId ?? profileQuery.data?.id ?? "";
  const businessName = profileQuery.data?.name?.trim() || user?.name || "CareTip";

  const teamQuery = useQuery({
    queryKey: keys.businessEmployees(businessId),
    queryFn: () => fetchBusinessEmployees(businessId),
    enabled: Boolean(userId && businessId),
    staleTime: queryStaleTimes.roster,
  });

  const employees = teamQuery.data ?? [];
  const activeCount = useMemo(() => employees.length, [employees.length]);

  const onGenerateInvite = useCallback(async () => {
    setGenerating(true);
    try {
      const data = await generateBusinessInviteCode();
      setInviteCode(data.inviteCode);
      setInviteExpiresAt(data.expiresAt ?? null);
      showSuccessToast(t("team.inviteGenerated"));
    } catch (error) {
      showErrorToast(friendlyErrorMessage(error, t("team.inviteGenerateError"), t));
    } finally {
      setGenerating(false);
    }
  }, [t]);

  const onCopyInvite = useCallback(async () => {
    if (!inviteCode) return;
    try {
      await copyToClipboard(inviteCode);
      showSuccessToast(t("team.inviteCopied"));
    } catch {
      showErrorToast(t("team.inviteCopyError"));
    }
  }, [inviteCode, t]);

  const onShareInvite = useCallback(async () => {
    if (!inviteCode) return;
    setSharing(true);
    try {
      await shareInvite({
        inviteCode,
        message: t("team.inviteShareMessage", { code: inviteCode, business: businessName }),
        dialogTitle: t("team.inviteShareTitle"),
        successMessage: t("team.inviteShared"),
        errorMessage: t("team.inviteShareError"),
      });
    } finally {
      setSharing(false);
    }
  }, [inviteCode, businessName, t]);

  return (
    <Screen tabSafe>
      <DetailScreenHeader
        title={t("team.title")}
        subtitle={t("team.subtitle", { count: formatCount(activeCount) })}
        fallbackHref="/(app)/business/settings"
      />

      <Section title={t("team.addEmployeeTitle")}>
        <View style={styles.inviteBlock}>
          <Text style={styles.inviteBody}>{t("team.addEmployeeBody")}</Text>
          <Button
            label={inviteCode ? t("team.regenerateInvite") : t("team.generateInvite")}
            onPress={() => void onGenerateInvite()}
            loading={generating}
          />
          {inviteCode ? (
            <View style={styles.inviteResult}>
              <Text style={styles.inviteLabel}>{t("team.inviteCodeLabel")}</Text>
              <Text style={styles.inviteCode} selectable>
                {inviteCode}
              </Text>
              {inviteExpiresAt ? (
                <Text style={styles.inviteExpiry}>
                  {t("team.inviteExpires", {
                    date: formatInviteExpiry(inviteExpiresAt, language),
                  })}
                </Text>
              ) : null}
              <View style={styles.inviteActions}>
                <Button
                  label={t("team.copyInvite")}
                  variant="outline"
                  onPress={() => void onCopyInvite()}
                  style={styles.inviteActionBtn}
                />
                <Button
                  label={t("team.shareInvite")}
                  variant="secondary"
                  onPress={() => void onShareInvite()}
                  loading={sharing}
                  style={styles.inviteActionBtn}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Section>

      {teamQuery.isLoading && employees.length === 0 ? (
        <SkeletonListRows count={6} />
      ) : teamQuery.isError ? (
        <ErrorState
          message={friendlyErrorMessage(teamQuery.error, t("team.loadError"), t)}
          onRetry={() => void teamQuery.refetch()}
        />
      ) : employees.length === 0 ? (
        <EmptyState
          variant="generic"
          title={t("team.emptyTitle")}
          message={t("team.emptyMessage")}
        />
      ) : (
        <Section title={t("team.rosterTitle")}>
          <GroupedList>
            {employees.map((employee, index) => (
              <GroupedRow
                key={employee.id}
                showDivider={index < employees.length - 1}
              >
                <View style={styles.row}>
                  <RemoteAvatar
                    displayName={employee.name}
                    uri={employee.avatar}
                    tone="brand"
                    size={40}
                    cacheBust={teamQuery.dataUpdatedAt}
                  />
                  <View style={styles.body}>
                    <Text style={styles.name}>{employee.name}</Text>
                    <Text style={styles.meta}>
                      {employee.role || t("team.staffFallback")}
                      {employee.rating != null ? ` · ★ ${employee.rating.toFixed(1)}` : ""}
                    </Text>
                  </View>
                  <View style={styles.trailing}>
                    <Text style={styles.tips}>{formatCount(employee.tips)}</Text>
                    <Text style={styles.tipsLabel}>{t("team.tipsLabel")}</Text>
                  </View>
                </View>
              </GroupedRow>
            ))}
          </GroupedList>
        </Section>
      )}
    </Screen>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    inviteBlock: {
      gap: spacing.md,
    },
    inviteBody: {
      ...typography.body,
      color: colors.mutedForeground,
    },
    inviteResult: {
      gap: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    inviteLabel: {
      ...typography.caption,
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    inviteCode: {
      ...typography.title,
      color: colors.foreground,
      letterSpacing: 2,
      fontVariant: ["tabular-nums"],
    },
    inviteExpiry: {
      ...typography.caption,
      color: colors.mutedForeground,
    },
    inviteActions: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    inviteActionBtn: {
      flex: 1,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    body: {
      flex: 1,
      gap: spacing.xxs,
    },
    name: {
      ...typography.body,
      color: colors.foreground,
      fontWeight: "600",
    },
    meta: {
      ...typography.caption,
      color: colors.mutedForeground,
    },
    trailing: {
      alignItems: "flex-end",
    },
    tips: {
      ...typography.body,
      color: colors.foreground,
      fontWeight: "600",
    },
    tipsLabel: {
      ...typography.caption,
      color: colors.mutedForeground,
    },
  });
}
