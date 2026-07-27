import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProviders } from "@/components/providers/AppProviders";
import { AppErrorBoundary } from "@/components/providers/AppErrorBoundary";
import { colors } from "@/theme";

/**
 * Root layout — providers + navigation shell.
 */
export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <AppProviders>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: "fade",
          }}
        />
      </AppProviders>
    </AppErrorBoundary>
  );
}
