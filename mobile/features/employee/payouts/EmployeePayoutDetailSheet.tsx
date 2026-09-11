import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { radius, spacing, touchTarget, typography } from "@/theme";
import { textA11y } from "@/theme/a11y";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  formatCentsEur,
  formatMaskedLast4,
  formatPayoutDate,
  formatPayoutTime,
} from "@/features/employee/payouts/payoutDisplay";

export type PayoutDetailKind = "caretip" | "bank";

export type PayoutDetailModel = {
  kind: PayoutDetailKind;
  title: string;
  amountCents: number;
  statusLabel: string;
  statusTone: "success" | "warning" | "danger" | "neutral";
  createdAt: string;
  destination?: string | null;
  methodLabel?: string | null;
  reference?: string | null;
};

type Props = {
  item: PayoutDetailModel | null;
  onClose: () => void;
};

export function EmployeePayoutDetailSheet({ item, onClose }: Props) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);
  const visible = item != null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("employeePayouts.close")}
        />
        {item ? (
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.handle} />
            <Text style={styles.kicker} {...textA11y}>
              {item.title}
            </Text>
            <Text
              style={styles.amount}
              accessibilityRole="header"
              {...textA11y}
            >
              {formatCentsEur(item.amountCents)}
            </Text>
            <StatusPill label={item.statusLabel} tone={item.statusTone} />

            <View style={styles.rows}>
              <DetailRow
                label={t("employeePayouts.detailDate")}
                value={`${formatPayoutDate(item.createdAt)} · ${formatPayoutTime(item.createdAt)}`}
              />
              <DetailRow label={t("employeePayouts.detailStatus")} value={item.statusLabel} />
              {item.destination ? (
                <DetailRow label={t("employeePayouts.detailDestination")} value={item.destination} />
              ) : null}
              {item.methodLabel ? (
                <DetailRow label={t("employeePayouts.detailMethod")} value={item.methodLabel} />
              ) : null}
              {item.reference ? (
                <DetailRow label={t("employeePayouts.detailReference")} value={item.reference} />
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("employeePayouts.close")}
              onPress={onClose}
              style={styles.close}
            >
              <Text style={styles.closeLabel} {...textA11y}>
                {t("employeePayouts.close")}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ ...typography.caption, color: colors.mutedForeground }} {...textA11y}>
        {label}
      </Text>
      <Text
        style={{
          ...typography.body,
          color: colors.foreground,
          fontWeight: "600",
        }}
        {...textA11y}
      >
        {value}
      </Text>
    </View>
  );
}

export function bankMethodLabel(
  method: "instant" | "standard" | "unknown",
  t: (key: string) => string,
): string {
  if (method === "instant") return t("employeePayouts.methodInstant");
  if (method === "standard") return t("employeePayouts.methodStandard");
  return t("employeePayouts.methodUnknown");
}

export function bankTitle(
  method: "instant" | "standard" | "unknown",
  t: (key: string) => string,
): string {
  if (method === "instant") return t("employeePayouts.instantBankPayout");
  return t("employeePayouts.bankPayout");
}

export function bankStatusLabel(status: string, t: (key: string) => string): string {
  const s = status.toLowerCase();
  if (s === "paid") return t("employeePayouts.statusPaid");
  if (s === "pending") return t("employeePayouts.statusPending");
  if (s === "in_transit") return t("employeePayouts.statusInTransit");
  if (s === "failed") return t("employeePayouts.statusFailed");
  if (s === "canceled") return t("employeePayouts.statusCanceled");
  if (s === "submitted") return t("employeePayouts.statusSubmitted");
  return t("employeePayouts.statusPending");
}

export { formatMaskedLast4 };

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
    },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius["2xl"],
      borderTopRightRadius: radius["2xl"],
      paddingHorizontal: spacing["2xl"],
      paddingTop: spacing.md,
      gap: spacing.md,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      marginBottom: spacing.sm,
    },
    kicker: { ...typography.caption, color: colors.mutedForeground, fontWeight: "600" },
    amount: { ...typography.hero, color: colors.foreground },
    rows: { gap: spacing.lg, marginTop: spacing.sm },
    close: {
      minHeight: touchTarget,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.lg,
      backgroundColor: colors.secondary,
      marginTop: spacing.sm,
    },
    closeLabel: { ...typography.button, color: colors.foreground },
  });
}
