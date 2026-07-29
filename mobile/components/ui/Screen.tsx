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
  /** Wrap scroll content in KeyboardAvoidingView — use on form-heavy screens. */
  keyboardAware?: boolean;
};

export function Screen({
  children,
  refreshing,
  onRefresh,
  padded = true,
  tabSafe = true,
  keyboardAware = false,
  contentContainerStyle,
  ...rest
}: ScreenProps) {
  const { width } = useWindowDimensions();
  const contentMaxWidth = width >= 768 ? 960 : 720;

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
          />
        ) : undefined
      }
      contentContainerStyle={[
        padded ? [styles.content, { maxWidth: contentMaxWidth }] : null,
        tabSafe ? styles.tabClearance : null,
        contentContainerStyle,
      ]}
      {...rest}
    >
      {children}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]} collapsable={false}>
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
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing["2xl"],
    width: "100%",
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
