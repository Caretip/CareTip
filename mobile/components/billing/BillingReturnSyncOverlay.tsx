import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";
import { useBillingReturnSyncStore } from "@/store/billingReturnSyncStore";
import { authBrand } from "@/theme/authBrand";
import { radius, spacing, typography } from "@/theme";

/** Non-blocking modal while subscription entitlements sync after web Billing. */
export function BillingReturnSyncOverlay() {
  const active = useBillingReturnSyncStore((s) => s.active);
  const message = useBillingReturnSyncStore((s) => s.message);

  return (
    <Modal visible={active} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <View style={styles.card}>
          <ActivityIndicator color={authBrand.orange} size="large" />
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(11, 18, 32, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing["3xl"],
  },
  card: {
    width: "100%",
    maxWidth: 320,
    borderRadius: radius.xl,
    backgroundColor: "#FFFFFF",
    paddingVertical: spacing["3xl"],
    paddingHorizontal: spacing["2xl"],
    alignItems: "center",
    gap: spacing.lg,
  },
  message: {
    ...typography.body,
    fontSize: 15,
    fontWeight: "600",
    color: "#0B1220",
    textAlign: "center",
  },
});
