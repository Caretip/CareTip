import { ErrorUtils } from "react-native";

/** Logs fatal JS errors in release so `adb logcat ReactNativeJS:* *:S` captures the first exception. */
export function installStartupErrorHandler(): void {
  if (__DEV__) return;

  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[CareTip][StartupFatal]", { isFatal, message, stack });
    previous?.(error, isFatal);
  });
}

installStartupErrorHandler();
