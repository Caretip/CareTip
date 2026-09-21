import { useAuth } from "../hooks/useAuth";
import { useFcmPushSync } from "../hooks/useFcmPushSync";
import { isAuthenticatedWithAccessToken } from "../lib/authRestore";

/** Headless FCM registration — respects server-side notification preferences. */
export function PushNotificationSync() {
  const { user, authStatus } = useAuth();
  useFcmPushSync(user, authStatus, isAuthenticatedWithAccessToken(user, authStatus));
  return null;
}
