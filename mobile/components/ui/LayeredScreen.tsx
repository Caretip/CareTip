import type { ReactNode } from "react";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { LayeredScreenShell } from "@/components/layout/LayeredScreenShell";
import { HeaderUtilityStack } from "@/components/ui/HeaderUtilityStack";
import { SplashScreenAnchor } from "@/components/brand/SplashScreenAnchor";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { ErrorBanner } from "@/components/layout/ErrorBanner";
import { premiumPalette } from "@/theme/dashboardPremium";
import { spacing, typography } from "@/theme";

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

/** App screens with premium hero + foreground sheet (dashboards, etc.). */
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
  const styles = useMemo(() => createStyles(), []);

  return (
    <SafeAreaView style={staticStyles.safe} edges={safeAreaEdges} collapsable={false}>
      <SplashScreenAnchor source="LayeredScreen" />
      <OfflineBanner />
      <ErrorBanner />
      <LayeredScreenShell
        background="gradient"
        refreshing={refreshing}
        onRefresh={onRefresh}
        tabSafe
        header={
          <View style={staticStyles.headerBlock}>
            <View style={staticStyles.headerRow}>
              <View style={staticStyles.headerMain}>
                <View style={styles.titleGlow} pointerEvents="none" />
                {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
                <Text style={styles.title}>{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              {showHeaderUtilities && notificationsHref ? (
                <HeaderUtilityStack notificationsHref={notificationsHref} />
              ) : null}
            </View>
            {headerExtra ? <View style={staticStyles.headerExtra}>{headerExtra}</View> : null}
          </View>
        }
      >
        {children}
      </LayeredScreenShell>
    </SafeAreaView>
  );
}

function createStyles() {
  return StyleSheet.create({
    titleGlow: {
      position: "absolute",
      top: -12,
      left: -8,
      width: 140,
      height: 140,
      borderRadius: 999,
      backgroundColor: "rgba(255, 255, 255, 0.12)",
    },
    eyebrow: {
      ...typography.overline,
      color: "rgba(255,255,255,0.82)",
      letterSpacing: 1.8,
      fontSize: 10,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    title: {
      ...typography.h1,
      color: "#FFFFFF",
      fontSize: 32,
      lineHeight: 38,
      letterSpacing: -0.8,
      fontWeight: "800",
    },
    subtitle: {
      ...typography.body,
      color: "rgba(255,255,255,0.9)",
      fontSize: 15,
      lineHeight: 21,
      fontWeight: "500",
      letterSpacing: 0.05,
    },
  });
}

const staticStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: premiumPalette.primary,
  },
  headerBlock: {
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
    position: "relative",
  },
  headerExtra: {
    marginTop: spacing.xxs,
  },
});
