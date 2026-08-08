import { Stack } from "expo-router";
import { NativeSplashGate } from "@/components/brand/NativeSplashGate";
import { ToastHost } from "@/components/ui/ToastHost";
import { authBrand } from "@/theme/authBrand";

export function ThemedRootNavigation() {
  return (
    <NativeSplashGate>
      <Stack
        screenOptions={{
          headerShown: false,
          // Orange during gated boot prevents gray/white flash under the overlay fade.
          contentStyle: { backgroundColor: authBrand.orange },
          animation: "fade",
          animationDuration: 220,
        }}
      />
      <ToastHost />
    </NativeSplashGate>
  );
}
