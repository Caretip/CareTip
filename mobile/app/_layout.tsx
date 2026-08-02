import "@/utils/startupErrorHandler";
import "@/utils/splashLifecycle";
import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StyleSheet } from "react-native";
import { AppProviders } from "@/components/providers/AppProviders";
import { AppErrorBoundary } from "@/components/providers/AppErrorBoundary";
import { ThemedRootNavigation } from "@/components/navigation/ThemedRootNavigation";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <AppErrorBoundary>
        <AppProviders>
          <ThemedRootNavigation />
        </AppProviders>
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
