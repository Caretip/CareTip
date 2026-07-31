import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { LayeredScreenShell } from "@/components/layout/LayeredScreenShell";
import { HeaderUtilityStack } from "@/components/ui/HeaderUtilityStack";
import { SplashScreenAnchor } from "@/components/brand/SplashScreenAnchor";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { ErrorBanner } from "@/components/layout/ErrorBanner";
import { heroText } from "@/theme/surfaces";
import { brand, spacing, typography } from "@/theme";

type LayeredScreenProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  headerExtra?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  safeAreaEdges?: Edge[];
  notificationsHref?: string;
  showHeaderUtilities?: boolean;
};

/** App screens with orange hero + white foreground sheet (dashboards, etc.). */
export function LayeredScreen({
  eyebrow,
  title,
  subtitle,
  headerExtra,
  children,
  refreshing,
  onRefresh,
  safeAreaEdges = ["top", "left", "right"],
  notificationsHref,
  showHeaderUtilities = true,
}: LayeredScreenProps) {
  return (
    <SafeAreaView style={styles.safe} edges={safeAreaEdges} collapsable={false}>
      <SplashScreenAnchor source="LayeredScreen" />
      <OfflineBanner />
      <ErrorBanner />
      <LayeredScreenShell
        background="gradient"
        refreshing={refreshing}
        onRefresh={onRefresh}
        tabSafe
        header={
          <View style={styles.headerRow}>
            <View style={styles.headerMain}>
              {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              {headerExtra}
            </View>
            {showHeaderUtilities && notificationsHref ? (
              <HeaderUtilityStack notificationsHref={notificationsHref} />
            ) : null}
          </View>
        }
      >
        {children}
      </LayeredScreenShell>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: brand.orange,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.lg,
    paddingTop: spacing.sm,
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
  },
  eyebrow: {
    ...typography.overline,
    color: heroText.label,
    letterSpacing: 1.1,
  },
  title: {
    ...typography.h1,
    color: heroText.value,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.8,
    fontWeight: "800",
  },
  subtitle: {
    ...typography.body,
    color: heroText.hint,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
  },
});
