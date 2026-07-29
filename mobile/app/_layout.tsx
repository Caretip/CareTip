import "@/utils/splashLifecycle";
import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProviders } from "@/components/providers/AppProviders";
import { AppErrorBoundary } from "@/components/providers/AppErrorBoundary";
import { NativeSplashGate } from "@/components/brand/NativeSplashGate";
import { ToastHost } from "@/components/ui/ToastHost";
import { colors } from "@/theme";

function RootNavigation() {
  return (
    <NativeSplashGate>
      <StatusBar style="dark" />
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

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <AppProviders>
        <RootNavigation />
      </AppProviders>
    </AppErrorBoundary>
  );
}
