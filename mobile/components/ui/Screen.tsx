import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ScrollViewProps,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets, type Edge } from "react-native-safe-area-context";
import { spacing, screenPadding } from "@/theme";
import { tabBarScrollClearance } from "@/theme/navigation";
import { useTheme } from "@/hooks/useTheme";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { ErrorBanner } from "@/components/layout/ErrorBanner";
import { SplashScreenAnchor } from "@/components/brand/SplashScreenAnchor";

type ScreenProps = ScrollViewProps & {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  tabSafe?: boolean;
  keyboardAware?: boolean;
  safeAreaEdges?: Edge[];
};

export function Screen({
  children,
  refreshing,
  onRefresh,
  padded = true,
  tabSafe = true,
  keyboardAware = false,
  safeAreaEdges = ["top", "left", "right"],
  contentContainerStyle,
  ...rest
}: ScreenProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const contentMaxWidth = width >= 768 ? 960 : 720;
  const bottomClearance = tabSafe
    ? tabBarScrollClearance(insets.bottom)
    : Math.max(insets.bottom, spacing.lg);

  const scroll = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.background}
          />
        ) : undefined
      }
      contentContainerStyle={[
        padded ? [styles.content, { maxWidth: contentMaxWidth }] : null,
        contentContainerStyle,
        // Keep last so callers cannot wipe tab/home-indicator clearance.
        { paddingBottom: bottomClearance },
      ]}
      {...rest}
    >
      {children}
    </ScrollView>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={safeAreaEdges} collapsable={false}>
      <SplashScreenAnchor source="Screen" />
      <OfflineBanner />
      <ErrorBanner />
      {keyboardAware ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? spacing.lg : 0}
        >
          {scroll}
        </KeyboardAvoidingView>
      ) : (
        scroll
      )}
    </SafeAreaView>
  );
}

export function ScreenHeader({ children }: { children: React.ReactNode }) {
  return <View style={styles.header}>{children}</View>;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.lg,
    gap: spacing["3xl"],
    width: "100%",
    alignSelf: "center",
  },
  header: {
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
});
