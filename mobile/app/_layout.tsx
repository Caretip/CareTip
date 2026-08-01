import "@/utils/startupErrorHandler";
import "@/utils/splashLifecycle";
import "react-native-gesture-handler";
import { AppProviders } from "@/components/providers/AppProviders";
import { AppErrorBoundary } from "@/components/providers/AppErrorBoundary";
import { ThemedRootNavigation } from "@/components/navigation/ThemedRootNavigation";

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <AppProviders>
        <ThemedRootNavigation />
      </AppProviders>
    </AppErrorBoundary>
  );
}
