import { Suspense, lazy, type ComponentType } from "react";
import { StyleSheet, View } from "react-native";
import { SkeletonListRows } from "@/components/ui/Skeleton";
import { screenContentPadding } from "@/components/ui/ScreenShell";

function LazyScreenFallback() {
  return (
    <View style={styles.fallback}>
      <SkeletonListRows count={4} />
    </View>
  );
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
    paddingTop: 24,
  },
});
