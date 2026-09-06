import { lazy, Suspense } from 'react';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { router } from './routes';
import { TipFlowProvider } from './context/TipFlowContext';
import { AppLoadingSplashProvider } from './context/AppLoadingSplashContext';
import { AppLoadingManagerProvider } from './context/AppLoadingManager';
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { AuthProvider } from "./components/AuthProvider";
import { SocketProvider } from "./context/SocketProvider";
import { CookieConsentProvider } from "./context/CookieConsentContext";

const PwaInstallPrompt = lazy(() =>
  import('./components/PwaInstallPrompt').then((m) => ({ default: m.PwaInstallPrompt })),
);

function AppTree() {
  const { resolvedTheme } = useTheme();
  return (
    <CookieConsentProvider>
      <TipFlowProvider>
        <AppLoadingSplashProvider>
          <AuthProvider>
            <AppLoadingManagerProvider>
              <SocketProvider>
                <RouterProvider router={router} />
              </SocketProvider>
            </AppLoadingManagerProvider>
          </AuthProvider>
          <Toaster theme={resolvedTheme} position="top-center" closeButton />
          <Suspense fallback={null}>
            <PwaInstallPrompt />
          </Suspense>
        </AppLoadingSplashProvider>
      </TipFlowProvider>
    </CookieConsentProvider>
  );
}

function AppWithTheme() {
  return (
    <ThemeProvider>
      <AppTree />
    </ThemeProvider>
  );
}

export default function App() {
  return <AppWithTheme />;
}
