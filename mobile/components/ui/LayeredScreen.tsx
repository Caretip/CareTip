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
  /** Small greeting above the name (e.g. "Welcome back"). */
  eyebrow?: string;
  /** User display name — largest text in the compact welcome header. */
  title: string;
  /** Role label under the greeting (Employee / Manager / job title). */
  role?: string;
  /** Business / venue name under the role. */
  subtitle?: string;
  /** Profile avatar shown beside the welcome text (RemoteAvatar). */
  leading?: ReactNode;
  /** Rendered at the bottom of the hero (period toggle, etc.). */
  headerExtra?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  safeAreaEdges?: Edge[];
  showHeaderUtilities?: boolean;
};

/**
 * App screens with premium hero + foreground sheet (Employee / Manager dashboards).
 * Welcome header: avatar | greeting + name + role + business | utilities.
 */
export function LayeredScreen({
  eyebrow,
  title,
  role,
  subtitle,
  leading,
  headerExtra,
  children,
  refreshing,
  onRefresh,
  safeAreaEdges = ["top", "left", "right"],
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
              {leading ? <View style={staticStyles.leading}>{leading}</View> : null}
              <View style={staticStyles.headerMain}>
                {eyebrow ? (
                  <Text style={styles.eyebrow} numberOfLines={1}>
                    {eyebrow}
                  </Text>
                ) : null}
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
                {role ? (
                  <Text style={styles.role} numberOfLines={1}>
                    {role}
                  </Text>
                ) : null}
                {subtitle ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              {showHeaderUtilities ? <HeaderUtilityStack /> : null}
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
    eyebrow: {
      ...typography.caption,
      color: "rgba(255,255,255,0.78)",
      fontWeight: "500",
    },
    title: {
      ...typography.section,
      color: "#FFFFFF",
      fontWeight: "700",
      letterSpacing: -0.3,
    },
    role: {
      ...typography.caption,
      color: "rgba(255,255,255,0.88)",
      fontWeight: "500",
    },
    subtitle: {
      ...typography.caption,
      color: "rgba(255,255,255,0.72)",
      fontWeight: "500",
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
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxs,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  leading: {
    flexShrink: 0,
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    justifyContent: "center",
  },
  headerExtra: {
    marginTop: spacing.xxs,
  },
});
