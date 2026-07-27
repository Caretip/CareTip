import { lazy, Suspense } from 'react';
import { RouterProvider } from 'react-router';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Toaster } from 'sonner';
import { router } from './routes';
import { TipFlowProvider } from './context/TipFlowContext';
import { AppLoadingSplashProvider } from './context/AppLoadingSplashContext';
import { AppLoadingManagerProvider } from './context/AppLoadingManager';
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { AuthProvider } from "./components/AuthProvider";
import { SocketProvider } from "./context/SocketProvider";
import { googleOAuthWebClientId } from "./lib/googleOAuthWebClientId";
import { CookieConsentProvider } from "./context/CookieConsentContext";

const PwaInstallPrompt = lazy(() =>
  import('./components/PwaInstallPrompt').then((m) => ({ default: m.PwaInstallPrompt })),
);

const googleClientId = googleOAuthWebClientId();

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
  if (googleClientId) {
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        <AppWithTheme />
      </GoogleOAuthProvider>
    );
  }
  return <AppWithTheme />;
}
