import { useMemo, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PeriodToggle } from "@/components/ui/PeriodToggle";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { StatusPill } from "@/components/ui/StatusPill";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import {
  fetchEmployeePayableActivity,
  fetchEmployeeStripeBankPayouts,
  openEmployeeStripeDashboard,
  type EmployeePayableActivityItem,
  type EmployeeStripeBankPayoutItem,
} from "@/services/api/employeePayoutService";
import {
  bankPayoutStatusTone,
  employeePayoutActivityKind,
  employeePayoutActivityShowsStatusPill,
  employeePayoutActivityTone,
} from "@/features/employee/payouts/employeeInstantPayoutPresentation";
import {
  EmployeePayoutDetailSheet,
  bankMethodLabel,
  bankStatusLabel,
  bankTitle,
  type PayoutDetailModel,
} from "@/features/employee/payouts/EmployeePayoutDetailSheet";
import {
  formatCentsEur,
  formatMaskedLast4,
  formatPayoutDateTime,
} from "@/features/employee/payouts/payoutDisplay";
import { spacing, touchTarget, typography } from "@/theme";
import { textA11y } from "@/theme/a11y";
import type { ColorPalette } from "@/theme/colors";

type HistoryTab = "caretip" | "bank";

function activityTitle(kind: ReturnType<typeof employeePayoutActivityKind>, t: (k: string) => string) {
  if (kind === "held_venue") return t("employeePayouts.venueDistribution");
  return t("employeePayouts.caretipTransfer");
}

function activityStatusLabel(kind: ReturnType<typeof employeePayoutActivityKind>, t: (k: string) => string) {
  if (kind === "transferred") return t("employeePayouts.activityTransferred");
  if (kind === "destination_routed") return t("employeePayouts.activityRouted");
  if (kind === "held") return t("employeePayouts.activityHeld");
  if (kind === "held_venue") return t("employeePayouts.activityHeldVenue");
  if (kind === "transferring") return t("employeePayouts.activityTransferring");
  if (kind === "refunded") return t("employeePayouts.activityRefunded");
  if (kind === "failed") return t("employeePayouts.activityFailed");
  return t("employeePayouts.activityDisputed");
}

function activityDestination(kind: ReturnType<typeof employeePayoutActivityKind>, t: (k: string) => string) {
  if (kind === "held_venue") return t("employeePayouts.destVenue");
  if (kind === "transferred" || kind === "destination_routed") return t("employeePayouts.paidToStripe");
  return t("employeePayouts.destStripe");
}

export function EmployeePayoutHistoryScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const [tab, setTab] = useState<HistoryTab>("caretip");
  const [detail, setDetail] = useState<PayoutDetailModel | null>(null);
  const [openingStripe, setOpeningStripe] = useState(false);

  const payablesQuery = useQuery({
    queryKey: [...keys.employeeMe, "payables"] as const,
    queryFn: fetchEmployeePayableActivity,
    enabled: Boolean(userId),
  });
  const bankQuery = useQuery({
    queryKey: [...keys.employeeMe, "stripe-payouts"] as const,
    queryFn: fetchEmployeeStripeBankPayouts,
    enabled: Boolean(userId),
  });

  const openCaretip = (row: EmployeePayableActivityItem) => {
    const kind = employeePayoutActivityKind(row);
    setDetail({
      kind: "caretip",
      title: activityTitle(kind, t),
      amountCents: row.activityCents,
      statusLabel: activityStatusLabel(kind, t),
      statusTone: employeePayoutActivityTone(kind),
      createdAt: row.createdAt,
      destination: activityDestination(kind, t),
      methodLabel: null,
      reference: null,
    });
  };

  const openBank = (row: EmployeeStripeBankPayoutItem) => {
    const masked = formatMaskedLast4(row.destinationLast4);
    setDetail({
      kind: "bank",
      title: bankTitle(row.method, t),
      amountCents: row.amountCents,
      statusLabel: bankStatusLabel(row.status, t),
      statusTone: bankPayoutStatusTone(row.status),
      createdAt: row.createdAt,
      destination: masked,
      methodLabel: bankMethodLabel(row.method, t),
      reference: row.stripePayoutId?.startsWith("po_") ? row.stripePayoutId : null,
    });
  };

  const openStripe = async () => {
    if (openingStripe) return;
    setOpeningStripe(true);
    try {
      const { url } = await openEmployeeStripeDashboard();
      if (url) await Linking.openURL(url);
    } catch {
      Alert.alert(t("employeePayouts.loadError"));
    } finally {
      setOpeningStripe(false);
    }
  };

  return (
    <Screen
      refreshing={payablesQuery.isRefetching || bankQuery.isRefetching}
      onRefresh={() => {
        void payablesQuery.refetch();
        void bankQuery.refetch();
      }}
      contentContainerStyle={{ gap: spacing.lg }}
    >
      <ScreenHeader
        title={t("employeePayouts.historyTitle")}
        subtitle={t("employeePayouts.historySubtitle")}
        trailing={
          <Pressable
            onPress={() => void openStripe()}
            disabled={openingStripe}
            accessibilityRole="link"
            accessibilityLabel={t("employeePayouts.viewInStripe")}
            hitSlop={8}
          >
            <Text style={styles.viewInStripe}>{t("employeePayouts.viewInStripe")}</Text>
          </Pressable>
        }
      />
      <PeriodToggle
        value={tab}
        options={[
          { value: "caretip", label: t("employeePayouts.caretipTab") },
          { value: "bank", label: t("employeePayouts.bankTab") },
        ]}
        onChange={setTab}
      />

      {tab === "caretip" ? (
        payablesQuery.isLoading && !payablesQuery.data ? (
          <SkeletonListRows count={4} />
        ) : payablesQuery.isError && !payablesQuery.data ? (
          <ErrorState
            title={t("employeePayouts.loadPayoutInfoTitle")}
            message={t("employeePayouts.historyLoadError")}
            onRetry={() => void payablesQuery.refetch()}
          />
        ) : !payablesQuery.data?.items.length ? (
          <EmptyState
            surface="flat"
            variant="tips"
            title={t("employeePayouts.historyEmptyCaretip")}
            message={t("employeePayouts.historyEmptyCaretipBody")}
          />
        ) : (
          <View style={styles.list}>
            {payablesQuery.data.items.map((row) => {
              const kind = employeePayoutActivityKind(row);
              const a11y = [
                activityTitle(kind, t),
                formatCentsEur(row.activityCents),
                activityStatusLabel(kind, t),
                formatPayoutDateTime(row.createdAt),
                activityDestination(kind, t),
              ].join(". ");
              return (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={a11y}
                  onPress={() => openCaretip(row)}
                  style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
                >
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} {...textA11y}>
                      {activityTitle(kind, t)}
                    </Text>
                    <Text style={styles.rowMeta} {...textA11y}>
                      {formatPayoutDateTime(row.createdAt)}
                    </Text>
                    <Text style={styles.rowMeta} {...textA11y}>
                      {activityDestination(kind, t)}
                    </Text>
                  </View>
                  <View style={styles.rowEnd}>
                    <Text style={styles.rowAmount} {...textA11y}>
                      {formatCentsEur(row.activityCents)}
                    </Text>
                    {employeePayoutActivityShowsStatusPill(kind) ? (
                      <StatusPill label={activityStatusLabel(kind, t)} tone={employeePayoutActivityTone(kind)} />
                    ) : (
                      <Text style={styles.rowMeta} {...textA11y}>
                        {activityStatusLabel(kind, t)}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )
      ) : bankQuery.isLoading && !bankQuery.data ? (
        <SkeletonListRows count={4} />
      ) : bankQuery.isError && !bankQuery.data ? (
        <ErrorState
          title={t("employeePayouts.historyUnavailable")}
          message={t("employeePayouts.historyLoadError")}
          onRetry={() => void bankQuery.refetch()}
        />
      ) : bankQuery.data && !bankQuery.data.stripeReadable ? (
        <EmptyState
          surface="flat"
          variant="generic"
          title={t("employeePayouts.historyUnavailable")}
          message={t("employeePayouts.historyUnavailableBody")}
          actionLabel={t("employeePayouts.tryAgain")}
          onAction={() => void bankQuery.refetch()}
        />
      ) : !bankQuery.data?.items.length ? (
        <EmptyState
          surface="flat"
          variant="tips"
          title={t("employeePayouts.historyEmptyBank")}
          message={t("employeePayouts.historyEmptyBankBody")}
        />
      ) : (
        <View style={styles.list}>
          {bankQuery.data.items.map((row, index) => {
            const masked = formatMaskedLast4(row.destinationLast4);
            const title = bankTitle(row.method, t);
            const a11y = [
              title,
              formatCentsEur(row.amountCents),
              bankStatusLabel(row.status, t),
              formatPayoutDateTime(row.createdAt),
              masked,
            ]
              .filter(Boolean)
              .join(". ");
            return (
              <Pressable
                key={row.stripePayoutId ?? `${row.createdAt}-${row.amountCents}-${index}`}
                accessibilityRole="button"
                accessibilityLabel={a11y}
                onPress={() => openBank(row)}
                style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} {...textA11y}>
                    {title}
                  </Text>
                  <Text style={styles.rowMeta} {...textA11y}>
                    {formatPayoutDateTime(row.createdAt)}
                  </Text>
                  {masked ? (
                    <Text style={styles.rowMeta} {...textA11y}>
                      {masked}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.rowEnd}>
                  <Text style={styles.rowAmount} {...textA11y}>
                    {formatCentsEur(row.amountCents)}
                  </Text>
                  <StatusPill label={bankStatusLabel(row.status, t)} tone={bankPayoutStatusTone(row.status)} />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <EmployeePayoutDetailSheet item={detail} onClose={() => setDetail(null)} />
    </Screen>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    list: { gap: 0, marginTop: spacing.md },
    row: {
      minHeight: touchTarget + 8,
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    pressed: { opacity: 0.72 },
    viewInStripe: {
      ...typography.caption,
      color: colors.primary,
      fontWeight: "600",
      textAlign: "right",
      maxWidth: 120,
    },
    rowMain: { flex: 1, gap: 2 },
    rowEnd: { alignItems: "flex-end", gap: spacing.xs },
    rowTitle: { ...typography.body, color: colors.foreground, fontWeight: "600" },
    rowMeta: { ...typography.caption, color: colors.mutedForeground },
    rowAmount: { ...typography.body, color: colors.foreground, fontWeight: "700" },
  });
}
