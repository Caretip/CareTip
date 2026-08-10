import { Stack } from "expo-router";
import { NativeSplashGate } from "@/components/brand/NativeSplashGate";
import { ToastHost } from "@/components/ui/ToastHost";
import { useBootstrapReady } from "@/hooks/useAppReady";
import { useTheme } from "@/hooks/useTheme";
import { authBrand } from "@/theme/authBrand";

export function ThemedRootNavigation() {
  const { colors } = useTheme();
  const bootstrapReady = useBootstrapReady();
  // Orange only during gated boot; after reveal use theme background to avoid
  // brand-orange flashes between authenticated screens.
  const contentBackground = bootstrapReady ? colors.background : authBrand.orange;

  return (
    <NativeSplashGate>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: contentBackground },
          animation: "fade",
          animationDuration: 220,
        }}
      />
      <ToastHost />
    </NativeSplashGate>
  );
}
