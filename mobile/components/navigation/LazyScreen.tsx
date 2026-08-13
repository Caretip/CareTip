import { Suspense, lazy, type ComponentType } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { screenContentPadding } from "@/components/ui/ScreenShell";

function LazyScreenFallback() {
  const { colors } = useTheme();
  return <View style={[styles.fallback, { backgroundColor: colors.background }]} />;
}

/** Defer heavy insight screens until first navigation — keeps dashboard/QR/settings instant. */
export function lazyScreen(loader: () => Promise<{ default: ComponentType<unknown> }>) {
  const LazyComponent = lazy(loader);
  return function LazyScreenRoute() {
    return (
      <Suspense fallback={<LazyScreenFallback />}>
        <LazyComponent />
      </Suspense>
    );
  };
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    ...screenContentPadding,
  },
});
