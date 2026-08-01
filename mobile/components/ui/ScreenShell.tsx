import { useMemo } from "react";
import { RefreshControl, StyleSheet, View, useWindowDimensions, type ViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import type { ColorPalette } from "@/theme/colors";
import { spacing } from "@/theme";
import { TAB_BAR_SCROLL_CLEARANCE } from "@/theme/navigation";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { ErrorBanner } from "@/components/layout/ErrorBanner";

type ScreenShellProps = ViewProps & {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
};

/** Safe area shell for FlatList screens — avoids nesting scroll views. */
export function ScreenShell({ children, refreshing, onRefresh, style, ...rest }: ScreenShellProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

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
  const { colors } = useTheme();
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

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.background,
    },
    body: {
      flex: 1,
    },
  });
}

export const screenContentPadding = {
  paddingHorizontal: spacing.xl,
  paddingTop: spacing.lg,
  paddingBottom: TAB_BAR_SCROLL_CLEARANCE,
  width: "100%" as const,
  maxWidth: 720,
  alignSelf: "center" as const,
};

export function useScreenContentPadding() {
  const { width } = useWindowDimensions();
  return {
    ...screenContentPadding,
    maxWidth: width >= 768 ? 960 : 720,
  };
}
