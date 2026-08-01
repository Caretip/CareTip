import type { ReactNode } from "react";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { LayeredScreenShell } from "@/components/layout/LayeredScreenShell";
import { HeaderUtilityStack } from "@/components/ui/HeaderUtilityStack";
import { SplashScreenAnchor } from "@/components/brand/SplashScreenAnchor";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { ErrorBanner } from "@/components/layout/ErrorBanner";
import { useTheme } from "@/hooks/useTheme";
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

/** App screens with orange hero + foreground sheet (dashboards, etc.). */
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
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(), []);

  return (
    <SafeAreaView
      style={[staticStyles.safe, { backgroundColor: isDark ? colors.background : brand.orange }]}
      edges={safeAreaEdges}
      collapsable={false}
    >
      <SplashScreenAnchor source="LayeredScreen" />
      <OfflineBanner />
      <ErrorBanner />
      <LayeredScreenShell
        background="gradient"
        refreshing={refreshing}
        onRefresh={onRefresh}
        tabSafe
        header={
          <View style={staticStyles.headerRow}>
            <View style={staticStyles.headerMain}>
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

function createStyles() {
  return StyleSheet.create({
    eyebrow: {
      ...typography.overline,
      color: "rgba(255,255,255,0.82)",
      letterSpacing: 1.1,
    },
    title: {
      ...typography.h1,
      color: "#FFFFFF",
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.8,
      fontWeight: "800",
    },
    subtitle: {
      ...typography.body,
      color: "rgba(255,255,255,0.88)",
      fontSize: 15,
      lineHeight: 22,
      fontWeight: "500",
    },
  });
}

const staticStyles = StyleSheet.create({
  safe: {
    flex: 1,
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
});
