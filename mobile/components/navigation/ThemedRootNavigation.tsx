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
  const suppressGroupFade = logoutTransition || !isAuthenticated;
  // Orange only during gated boot. Logout uses the auth canvas (not orange / not white).
  const contentBackground = !bootstrapReady
    ? authBrand.orange
    : suppressGroupFade
      ? authBrand.dark
      : colors.background;

  return (
    <NativeSplashGate>
      <View style={{ flex: 1, backgroundColor: contentBackground }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: contentBackground },
            animation: suppressGroupFade ? "none" : "fade",
            animationDuration: suppressGroupFade ? 0 : 220,
          }}
        />
        <ToastHost />
      </View>
    </NativeSplashGate>
  );
}
