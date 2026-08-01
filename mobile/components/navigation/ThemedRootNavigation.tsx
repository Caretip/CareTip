import { Stack } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { NativeSplashGate } from "@/components/brand/NativeSplashGate";
import { ToastHost } from "@/components/ui/ToastHost";

export function ThemedRootNavigation() {
  const { colors } = useTheme();

  return (
    <NativeSplashGate>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: "fade",
          animationDuration: 220,
        }}
      />
      <ToastHost />
    </NativeSplashGate>
  );
}
