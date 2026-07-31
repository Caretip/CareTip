type GlobalErrorUtils = {
  getGlobalHandler: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

/** Logs fatal JS errors in release when ErrorUtils is available (Bridgeless may omit it). */
export function installStartupErrorHandler(): void {
  const ErrorUtils = (global as typeof globalThis & { ErrorUtils?: GlobalErrorUtils })
    .ErrorUtils;

  if (
    __DEV__ ||
    !ErrorUtils ||
    typeof ErrorUtils.getGlobalHandler !== "function" ||
    typeof ErrorUtils.setGlobalHandler !== "function"
  ) {
    return;
  }

  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[CareTip][StartupFatal]", { isFatal, message, stack });
    previous?.(error, isFatal);
  });
}

installStartupErrorHandler();
