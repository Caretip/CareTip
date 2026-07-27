import { RefreshControl, ScrollView, StyleSheet, View, type ScrollViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { ErrorBanner } from "@/components/layout/ErrorBanner";

type ScreenProps = ScrollViewProps & {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
};

export function Screen({
  children,
  refreshing,
  onRefresh,
  padded = true,
  contentContainerStyle,
  ...rest
}: ScreenProps) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
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
        contentContainerStyle={[padded ? styles.content : null, contentContainerStyle]}
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
    paddingBottom: spacing["7xl"] + spacing["2xl"],
    gap: spacing.lg,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  header: {
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
});
