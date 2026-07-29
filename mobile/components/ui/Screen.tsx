import { RefreshControl, ScrollView, StyleSheet, View, type ScrollViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";
import { TAB_BAR_SCROLL_CLEARANCE } from "@/theme/navigation";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { ErrorBanner } from "@/components/layout/ErrorBanner";
import { SplashScreenAnchor } from "@/components/brand/SplashScreenAnchor";

type ScreenProps = ScrollViewProps & {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  tabSafe?: boolean;
};

export function Screen({
  children,
  refreshing,
  onRefresh,
  padded = true,
  tabSafe = true,
  contentContainerStyle,
  ...rest
}: ScreenProps) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]} collapsable={false}>
      <SplashScreenAnchor source="Screen" />
      <OfflineBanner />
      <ErrorBanner />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={Boolean(refreshing)}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          ) : undefined
        }
        contentContainerStyle={[
          padded ? styles.content : null,
          tabSafe ? styles.tabClearance : null,
          contentContainerStyle,
        ]}
        {...rest}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function ScreenHeader({ children }: { children: React.ReactNode }) {
  return <View style={styles.header}>{children}</View>;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing["2xl"],
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  tabClearance: {
    paddingBottom: TAB_BAR_SCROLL_CLEARANCE,
  },
  header: {
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
});
