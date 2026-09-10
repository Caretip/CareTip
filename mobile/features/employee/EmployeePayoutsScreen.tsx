import { useMemo, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AccessErrorState } from "@/components/ui/AccessErrorState";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { fetchEmployeeProfile } from "@/services/api/employeeService";
import {
  fetchEmployeeInstantPayoutEligibility,
  fetchEmployeeStripeBankPayouts,
  openEmployeeStripeDashboard,
  reactivateEmployeeReceiving,
  requestEmployeeInstantPayout,
  startEmployeeStripeUpdate,
} from "@/services/api/employeePayoutService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { formatEur } from "@/utils/format";
import { spacing, typography } from "@/theme";
import type { ColorPalette } from "@/theme/colors";

export function EmployeePayoutsScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const [busy, setBusy] = useState<"instant" | "reactivate" | "dash" | "update" | null>(null);

  const profileQuery = useQuery({
    queryKey: keys.employeeMe,
    queryFn: fetchEmployeeProfile,
    enabled: Boolean(userId),
    staleTime: queryStaleTimes.profile,
  });
  const instantQuery = useQuery({
    queryKey: [...keys.employeeMe, "instant-payout"] as const,
    queryFn: fetchEmployeeInstantPayoutEligibility,
    enabled: Boolean(userId),
  });
  const historyQuery = useQuery({
    queryKey: [...keys.employeeMe, "stripe-payouts"] as const,
    queryFn: fetchEmployeeStripeBankPayouts,
    enabled: Boolean(userId),
  });

  const receivingPaused = profileQuery.data?.receivingPaused === true;
  const eligibility = instantQuery.data;
  const history = historyQuery.data;

  const onInstant = async () => {
    if (busy) return;
    setBusy("instant");
    try {
      await requestEmployeeInstantPayout();
      await instantQuery.refetch();
      await historyQuery.refetch();
      Alert.alert(t("employeePayouts.instantSuccess"));
    } catch {
      Alert.alert(t("employeePayouts.instantFailed"));
    } finally {
      setBusy(null);
    }
  };

  const onReactivate = async () => {
    if (busy) return;
    setBusy("reactivate");
    try {
      await reactivateEmployeeReceiving();
      await profileQuery.refetch();
      Alert.alert(t("employeePayouts.reactivated"));
    } catch {
      Alert.alert(t("employeePayouts.loadError"));
    } finally {
      setBusy(null);
    }
  };

  const openUrl = async (kind: "dash" | "update") => {
    if (busy) return;
    setBusy(kind);
    try {
      const { url } = kind === "dash" ? await openEmployeeStripeDashboard() : await startEmployeeStripeUpdate();
      if (url) await Linking.openURL(url);
    } catch {
      Alert.alert(t("employeePayouts.loadError"));
    } finally {
      setBusy(null);
    }
  };

  if (profileQuery.error && !profileQuery.data) {
    return (
      <Screen>
        <AccessErrorState
          error={profileQuery.error}
          fallbackMessage={t("employeePayouts.loadError")}
          onRetry={() => void profileQuery.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t("employeePayouts.title")} subtitle={t("employeePayouts.subtitle")} />
      {receivingPaused ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("employeePayouts.pausedTitle")}</Text>
          <Text style={styles.body}>{t("employeePayouts.pausedBody")}</Text>
          <Pressable style={styles.primary} onPress={() => void onReactivate()} disabled={busy != null}>
            <Text style={styles.primaryText}>{t("employeePayouts.reactivateCta")}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("employeePayouts.instantTitle")}</Text>
        <Text style={styles.body}>{t("employeePayouts.instantLead")}</Text>
        <Text style={styles.meta}>{t("employeePayouts.instantMin")}</Text>
        <Text style={styles.meta}>{t("employeePayouts.instantFee")}</Text>
        <Text style={styles.meta}>{t("employeePayouts.noSteerHint")}</Text>
        {instantQuery.isLoading ? (
          <Text style={styles.body}>{t("employeePayouts.instantChecking")}</Text>
        ) : eligibility?.eligible ? (
          <>
            <Text style={styles.amount}>{formatEur((eligibility.instantAvailableNetCents ?? 0) / 100)}</Text>
            <Pressable style={styles.primary} onPress={() => void onInstant()} disabled={busy != null}>
              <Text style={styles.primaryText}>{t("employeePayouts.instantCta")}</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.body}>{t("employeePayouts.instantUnavailable")}</Text>
        )}
      </View>

      <View style={styles.row}>
        <Pressable style={styles.secondary} onPress={() => void openUrl("dash")} disabled={busy != null}>
          <Text style={styles.secondaryText}>{t("employeePayouts.dashboardCta")}</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => void openUrl("update")} disabled={busy != null}>
          <Text style={styles.secondaryText}>{t("employeePayouts.updateDetailsCta")}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("employeePayouts.historyTitle")}</Text>
        <Text style={styles.body}>{t("employeePayouts.historyHint")}</Text>
        {!history?.items?.length ? (
          <EmptyState title={t("employeePayouts.historyEmpty")} message={t("employeePayouts.historyHint")} />
        ) : (
          history.items.map((row) => (
            <Text key={`${row.createdAt}-${row.amountCents}`} style={styles.historyRow}>
              {formatEur(row.amountCents / 100)} · {row.status} · {row.method}
            </Text>
          ))
        )}
      </View>
    </Screen>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    card: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: 16,
      backgroundColor: colors.card,
      gap: spacing.sm,
    },
    cardTitle: { ...typography.h3, color: colors.foreground },
    body: { ...typography.body, color: colors.mutedForeground },
    meta: { ...typography.caption, color: colors.mutedForeground },
    amount: { ...typography.h1, color: colors.foreground },
    primary: {
      minHeight: 44,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.md,
    },
    primaryText: { ...typography.button, color: colors.primaryForeground },
    secondary: {
      flex: 1,
      minHeight: 44,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm,
    },
    secondaryText: { ...typography.caption, color: colors.foreground, textAlign: "center" },
    row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
    historyRow: { ...typography.body, color: colors.foreground, paddingVertical: 6 },
  });
}
