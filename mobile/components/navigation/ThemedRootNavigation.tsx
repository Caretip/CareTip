import { View } from "react-native";
import { Stack } from "expo-router";
import { NativeSplashGate } from "@/components/brand/NativeSplashGate";
import { ToastHost } from "@/components/ui/ToastHost";
import { useAuth } from "@/hooks/useAuth";
import { useAuthLogoutTransitionActive } from "@/hooks/useAuthLogoutTransition";
import { useBootstrapReady } from "@/hooks/useAppReady";
import { useTheme } from "@/hooks/useTheme";
import { authBrand } from "@/theme/authBrand";

export function ThemedRootNavigation() {
  const { colors } = useTheme();
  const { isAuthenticated } = useAuth();
  const bootstrapReady = useBootstrapReady();
  const logoutTransition = useAuthLogoutTransitionActive();
  const holdAuthCanvas = logoutTransition || !isAuthenticated;
  // Destination canvas only — native Expo splash covers startup (no React splash/orange underlay).
  // Before bootstrap settles, prefer auth-dark over white to avoid a light flash if hide races.
  const contentBackground = !bootstrapReady
    ? authBrand.dark
    : holdAuthCanvas
      ? authBrand.dark
      : colors.background;

  return (
    <NativeSplashGate>
      <View style={{ flex: 1, backgroundColor: contentBackground }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: contentBackground },
            animation: "none",
            animationDuration: 0,
          }}
        />
        <ToastHost />
      </View>
    </NativeSplashGate>
  );
}
