import { useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { AccessErrorState } from "@/components/ui/AccessErrorState";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { fetchEmployeeProfile } from "@/services/api/employeeService";
import {
  fetchEmployeeConnectStatus,
  fetchEmployeeInstantPayoutEligibility,
  newEmployeeInstantIdempotencyKey,
  isEmployeeInstantPayoutInFlight,
  openEmployeeStripeDashboard,
  reactivateEmployeeReceiving,
  requestEmployeeInstantPayout,
  startEmployeeStripeUpdate,
  type EmployeeInstantPayoutResult,
} from "@/services/api/employeePayoutService";
import { queryStaleTimes } from "@/services/api/queryClient";
import {
  employeeInstantCtaEnabled,
  employeeInstantFeePercentLabel,
  employeeInstantShowCta,
  employeeInstantUiMode,
} from "@/features/employee/payouts/employeeInstantPayoutPresentation";
import {
  formatCentsEur,
  formatMaskedLast4,
} from "@/features/employee/payouts/payoutDisplay";
import { EMPLOYEE_PAYOUTS_HISTORY_HREF } from "@/features/navigation/employeeRoutes";
import { radius, spacing, touchTarget, typography } from "@/theme";
import { metricTextA11y, textA11y } from "@/theme/a11y";
import type { ColorPalette } from "@/theme/colors";
import { friendlyErrorMessage } from "@/utils/friendlyError";

export function EmployeePaymentsConnectScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"instant" | "reactivate" | "dash" | "update" | "connect" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    payout: EmployeeInstantPayoutResult;
    last4: string | null;
  } | null>(null);
  const inFlightKey = useRef<string | null>(null);

  const profileQuery = useQuery({
    queryKey: keys.employeeMe,
    queryFn: fetchEmployeeProfile,
    enabled: Boolean(userId),
    staleTime: queryStaleTimes.profile,
  });
  const connectQuery = useQuery({
    queryKey: [...keys.employeeMe, "connect-status"] as const,
    queryFn: fetchEmployeeConnectStatus,
    enabled: Boolean(userId),
  });
  const instantQuery = useQuery({
    queryKey: [...keys.employeeMe, "instant-payout"] as const,
    queryFn: fetchEmployeeInstantPayoutEligibility,
    enabled: Boolean(userId),
  });

  const receivingPaused = profileQuery.data?.receivingPaused === true;
  const eligibility = instantQuery.data;
  const connect = connectQuery.data;
  const mode = employeeInstantUiMode(eligibility ?? null);
  const last4 = formatMaskedLast4(eligibility?.destinationLast4);
  const gross = eligibility?.instantAvailableGrossCents ?? 0;
  const net = eligibility?.instantAvailableNetCents ?? 0;
  const availableCents = gross > 0 ? gross : net;
  const minCents = eligibility?.minPayoutCents ?? 3000;
  const feeCents = eligibility?.platformFeeCents ?? 0;
  const feePercent = eligibility ? employeeInstantFeePercentLabel(eligibility) : null;
  const showInstantCta = employeeInstantShowCta(mode);
  const ctaEnabled = employeeInstantCtaEnabled(mode) && busy !== "instant" && !inFlightKey.current;
  const connectionState = connect?.connectionState ?? (eligibility?.connected ? "connected" : "not_connected");

  const refreshMoney = async () => {
    await Promise.all([instantQuery.refetch(), connectQuery.refetch(), profileQuery.refetch()]);
  };

  const onInstant = async () => {
    if (!employeeInstantCtaEnabled(mode) || busy || inFlightKey.current || isEmployeeInstantPayoutInFlight()) return;
    const key = newEmployeeInstantIdempotencyKey();
    inFlightKey.current = key;
    setBusy("instant");
    setSubmitError(null);
    setSuccess(null);
    try {
      const result = await requestEmployeeInstantPayout(key);
      setSuccess({
        payout: result.payout,
        last4: result.eligibility.destinationLast4 ?? eligibility?.destinationLast4 ?? null,
      });
      await instantQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: [...keys.employeeMe, "stripe-payouts"] });
    } catch (err) {
      if (err instanceof Error && err.message === "INSTANT_IN_FLIGHT") return;
      setSubmitError(friendlyErrorMessage(err, t("employeePayouts.instantFailed"), t));
    } finally {
      inFlightKey.current = null;
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

  const openUrl = async (kind: "dash" | "update" | "connect") => {
    if (busy) return;
    setBusy(kind);
    try {
      const { url } =
        kind === "dash" ? await openEmployeeStripeDashboard() : await startEmployeeStripeUpdate();
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

  const moneyLoading = instantQuery.isLoading && !instantQuery.data;
  const moneyError = instantQuery.isError && !instantQuery.data;

  const blockedReason = (() => {
    const reason = eligibility?.reason;
    if (reason === "no_instant_destination") return t("employeePayouts.reasonNoDestination");
    if (reason === "payouts_disabled") return t("employeePayouts.reasonPayoutsDisabled");
    if (reason === "country_unsupported") return t("employeePayouts.reasonCountry");
    if (reason === "business_closed") return t("employeePayouts.reasonBusinessClosed");
    return t("employeePayouts.instantUnavailable");
  })();

  const hint =
    mode === "ready"
      ? t("employeePayouts.availableForInstant")
      : mode === "threshold"
        ? t("employeePayouts.availableNow")
        : t("employeePayouts.readyWithdraw");

  return (
    <Screen
      refreshing={instantQuery.isRefetching && !busy}
      onRefresh={() => void refreshMoney()}
      contentContainerStyle={{ gap: spacing.xl }}
    >
      <ScreenHeader title={t("employeePayouts.title")} subtitle={t("employeePayouts.subtitle")} />

      {receivingPaused ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle} {...textA11y}>
            {t("employeePayouts.pausedTitle")}
          </Text>
          <Text style={styles.muted} {...textA11y}>
            {t("employeePayouts.pausedBody")}
          </Text>
          <Button
            label={t("employeePayouts.reactivateCta")}
            onPress={() => void onReactivate()}
            loading={busy === "reactivate"}
            disabled={busy != null}
            style={styles.rectCta}
          />
        </View>
      ) : null}

      {moneyLoading ? (
        <View style={styles.skel}>
          <Skeleton height={18} width="46%" />
          <Skeleton height={44} width="70%" />
          <Skeleton height={14} width="38%" />
          <Skeleton height={168} width="100%" rounded="xl" />
        </View>
      ) : moneyError ? (
        <ErrorState
          title={t("employeePayouts.loadPayoutInfoTitle")}
          message={t("employeePayouts.loadPayoutInfoBody")}
          onRetry={() => void instantQuery.refetch()}
        />
      ) : (
        <>
          {connectionState !== "not_connected" ? (
            <View
              style={styles.balanceBlock}
              accessible
              accessibilityLabel={`${t("employeePayouts.availableLabel")}. ${formatCentsEur(availableCents)}. ${hint}`}
            >
              <Text style={styles.sectionLabel} {...textA11y}>
                {t("employeePayouts.availableLabel")}
              </Text>
              <Text style={styles.heroAmount} {...metricTextA11y}>
                {formatCentsEur(availableCents)}
              </Text>
              <Text style={styles.muted} {...textA11y}>
                {hint}
              </Text>
            </View>
          ) : null}

          {success ? (
            <View style={styles.successCard} accessibilityRole="summary">
              <Text style={styles.successCheck} importantForAccessibility="no" accessibilityElementsHidden>
                ✓
              </Text>
              <Text style={styles.cardTitle} {...textA11y}>
                {t("employeePayouts.instantSuccessTitle")}
              </Text>
              <Text style={styles.receiveAmount} {...metricTextA11y}>
                {formatCentsEur(success.payout.amountCents)}
              </Text>
              {formatMaskedLast4(success.last4) ? (
                <Text style={styles.muted} {...textA11y}>
                  {t("employeePayouts.toLabel")} {formatMaskedLast4(success.last4)}
                </Text>
              ) : null}
              <Text style={styles.muted} {...textA11y}>
                {success.payout.status === "failed"
                  ? t("employeePayouts.statusFailed")
                  : success.payout.status === "pending"
                    ? t("employeePayouts.instantProcessing")
                    : t("employeePayouts.statusSubmitted")}
              </Text>
              <Button
                label={t("employeePayouts.viewHistory")}
                onPress={() => router.push(EMPLOYEE_PAYOUTS_HISTORY_HREF)}
                style={styles.rectCta}
              />
            </View>
          ) : connectionState === "not_connected" ? (
            <View style={styles.compactCard}>
              <Text style={styles.cardTitle} {...textA11y}>
                {t("employeePayouts.connectStripeTitle")}
              </Text>
              <Text style={styles.muted} {...textA11y}>
                {t("employeePayouts.connectStripeBody")}
              </Text>
              <Button
                label={t("employeePayouts.connectStripeCta")}
                onPress={() => void openUrl("connect")}
                loading={busy === "connect"}
                disabled={busy != null}
                style={styles.rectCta}
              />
            </View>
          ) : connectionState === "setup_required" || connectionState === "action_required" ? (
            <View style={styles.compactCard}>
              <Text style={styles.cardTitle} {...textA11y}>
                {t("employeePayouts.setupTitle")}
              </Text>
              <Text style={styles.muted} {...textA11y}>
                {t("employeePayouts.setupBody")}
              </Text>
              <Button
                label={t("employeePayouts.setupCta")}
                onPress={() => void openUrl("update")}
                loading={busy === "update"}
                disabled={busy != null}
                style={styles.rectCta}
              />
            </View>
          ) : (
            <View style={styles.compactCard}>
              <Text style={styles.cardTitle} {...textA11y}>
                {t("employeePayouts.instantTitle")}
              </Text>
              <Text style={styles.muted} {...textA11y}>
                {t("employeePayouts.instantLead")}
              </Text>

              {mode === "blocked" ? (
                <>
                  <Text style={styles.body} {...textA11y}>
                    {blockedReason}
                  </Text>
                  {connect?.canOpenDashboard || eligibility?.canOpenExpressDashboard ? (
                    <Button
                      label={t("employeePayouts.dashboardCta")}
                      variant="outline"
                      onPress={() => void openUrl("dash")}
                      loading={busy === "dash"}
                      disabled={busy != null}
                      style={styles.rectCta}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  {mode === "threshold" ? (
                    <View style={styles.kv}>
                      <View style={styles.kvItem}>
                        <Text style={styles.kvLabel}>{t("employeePayouts.availableAmountLabel")}</Text>
                        <Text style={styles.kvValue}>{formatCentsEur(availableCents)}</Text>
                      </View>
                      <View style={styles.kvItem}>
                        <Text style={styles.kvLabel}>{t("employeePayouts.minimumLabel")}</Text>
                        <Text style={styles.kvValue}>{formatCentsEur(minCents)}</Text>
                      </View>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.kvLabel}>{t("employeePayouts.youllReceive")}</Text>
                      <Text style={styles.receiveAmount} {...metricTextA11y}>
                        {formatCentsEur(net)}
                      </Text>
                    </>
                  )}

                  {last4 ? (
                    <Text style={styles.muted} {...textA11y}>
                      {t("employeePayouts.toLabel")} {last4}
                    </Text>
                  ) : null}

                  {eligibility?.feeConfigured && feeCents > 0 ? (
                    <Text style={styles.muted} {...textA11y}>
                      {t("employeePayouts.feeLabel")} {formatCentsEur(feeCents)}
                      {feePercent ? ` · ${feePercent}` : ""}
                    </Text>
                  ) : null}

                  {showInstantCta ? (
                    <Button
                      label={
                        busy === "instant"
                          ? t("employeePayouts.instantProcessing")
                          : t("employeePayouts.instantCtaAmount", { amount: formatCentsEur(net) })
                      }
                      onPress={() => void onInstant()}
                      loading={busy === "instant"}
                      disabled={!ctaEnabled}
                      style={styles.rectCta}
                      accessibilityLabel={t("employeePayouts.instantCtaAmount", {
                        amount: formatCentsEur(net),
                      })}
                    />
                  ) : null}

                  {mode === "threshold" ? (
                    <Text style={styles.helper} {...textA11y}>
                      {t("employeePayouts.instantMinHelper", { amount: formatCentsEur(minCents) })}
                    </Text>
                  ) : (
                    <Text style={styles.helper} {...textA11y}>
                      {t("employeePayouts.stripeProcessed")}
                    </Text>
                  )}
                </>
              )}

              {submitError ? (
                <Text style={styles.error} accessibilityRole="alert" {...textA11y}>
                  {submitError}
                </Text>
              ) : null}
            </View>
          )}

          {connectionState === "connected" || connectionState === "restricted" ? (
            <View style={styles.accountBlock}>
              <Text style={styles.sectionLabel} {...textA11y}>
                {t("employeePayouts.stripeAccount")}
              </Text>
              <View style={styles.accountRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.body} {...textA11y}>
                    {connectionState === "connected"
                      ? t("employeePayouts.connectedReady")
                      : t("employeePayouts.restrictedTitle")}
                  </Text>
                  {last4 ? (
                    <Text style={styles.muted} {...textA11y}>
                      {last4}
                    </Text>
                  ) : null}
                </View>
              </View>
              <View style={styles.secondaryRow}>
                {connect?.canOpenDashboard || eligibility?.canOpenExpressDashboard ? (
                  <Button
                    label={t("employeePayouts.dashboardCta")}
                    variant="outline"
                    onPress={() => void openUrl("dash")}
                    loading={busy === "dash"}
                    disabled={busy != null}
                    style={styles.secondaryBtn}
                  />
                ) : null}
                <Button
                  label={t("employeePayouts.updateDetailsCta")}
                  variant="ghost"
                  onPress={() => void openUrl("update")}
                  loading={busy === "update"}
                  disabled={busy != null}
                  style={styles.secondaryBtn}
                />
              </View>
            </View>
          ) : null}
        </>
      )}

      <Pressable
        onPress={() => router.push(EMPLOYEE_PAYOUTS_HISTORY_HREF)}
        accessibilityRole="button"
        accessibilityLabel={t("employeePayouts.historyNav")}
        style={({ pressed }) => [styles.historyLink, pressed ? { opacity: 0.7 } : null]}
      >
        <Text style={styles.historyLinkText} {...textA11y}>
          {t("employeePayouts.historyNav")}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </Pressable>
    </Screen>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    skel: { gap: spacing.md, marginTop: spacing.sm },
    balanceBlock: { gap: spacing.xs, paddingTop: spacing.sm },
    sectionLabel: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontWeight: "600",
      letterSpacing: 0.2,
    },
    heroAmount: {
      ...typography.display,
      color: colors.foreground,
    },
    muted: { ...typography.smallBody, color: colors.mutedForeground },
    body: { ...typography.body, color: colors.foreground },
    compactCard: {
      gap: spacing.sm,
      paddingTop: spacing.md,
    },
    cardTitle: { ...typography.h2, color: colors.foreground, fontWeight: "700" },
    receiveAmount: { ...typography.h1, color: colors.foreground },
    kv: { flexDirection: "row", gap: spacing["2xl"], paddingVertical: spacing.xs },
    kvItem: { gap: 2 },
    kvLabel: { ...typography.caption, color: colors.mutedForeground, fontWeight: "600" },
    kvValue: { ...typography.h3, color: colors.foreground, fontWeight: "700" },
    helper: { ...typography.caption, color: colors.mutedForeground, marginTop: spacing.xs },
    error: { ...typography.smallBody, color: colors.destructive },
    rectCta: {
      borderRadius: radius.lg,
      minHeight: touchTarget + 4,
      marginTop: spacing.sm,
    },
    notice: { gap: spacing.sm },
    noticeTitle: { ...typography.h3, color: colors.foreground },
    successCard: { gap: spacing.sm, paddingTop: spacing.md, alignItems: "flex-start" },
    successCheck: { ...typography.h1, color: colors.success },
    accountBlock: {
      gap: spacing.sm,
      paddingTop: spacing.xl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    accountRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    secondaryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    secondaryBtn: { borderRadius: radius.lg, flexGrow: 1, minWidth: "46%" },
    historyLink: {
      minHeight: touchTarget,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: spacing.lg,
      paddingVertical: spacing.sm,
    },
    historyLinkText: { ...typography.body, color: colors.primary, fontWeight: "700" },
  });
}
