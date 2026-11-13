// react-router/dom wires ReactDOM.flushSync, so navigate(to, { flushSync: true }) commits synchronously
// (logout relies on it to swap routes without an empty intermediate frame). Other navigations are unchanged.
import { RouterProvider } from 'react-router/dom';
import { Toaster } from 'sonner';
import { router } from './routes';
import { TipFlowProvider } from './context/TipFlowContext';
import { AppLoadingSplashProvider } from './context/AppLoadingSplashContext';
import { AppLoadingManagerProvider } from './context/AppLoadingManager';
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { AuthProvider } from "./components/AuthProvider";
import { SocketProvider } from "./context/SocketProvider";
import { CookieConsentProvider } from "./context/CookieConsentContext";

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme} position="top-center" closeButton />;
}

function AppTree() {
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
          <ThemedToaster />
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
