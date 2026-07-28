import { RefreshControl, StyleSheet, View, type ViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { ErrorBanner } from "@/components/layout/ErrorBanner";

type ScreenShellProps = ViewProps & {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
};

/** Safe area shell for FlatList screens — avoids nesting scroll views. */
export function ScreenShell({ children, refreshing, onRefresh, style, ...rest }: ScreenShellProps) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <OfflineBanner />
      <ErrorBanner />
      <View style={[styles.body, style]} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}

export function useListRefreshControl(refreshing?: boolean, onRefresh?: () => void) {
  if (!onRefresh) return undefined;
  return (
    <RefreshControl
      refreshing={Boolean(refreshing)}
      onRefresh={onRefresh}
      tintColor={colors.primary}
      colors={[colors.primary]}
    />
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
  },
});

export const screenContentPadding = {
  paddingHorizontal: spacing.xl,
  paddingTop: spacing.md,
  paddingBottom: spacing["7xl"] + spacing["2xl"],
  width: "100%" as const,
  maxWidth: 720,
  alignSelf: "center" as const,
};
