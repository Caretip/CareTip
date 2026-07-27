let sessionExpiredHandler: (() => void) | null = null;

export function registerSessionExpiredHandler(handler: () => void): void {
  sessionExpiredHandler = handler;
}

export function notifySessionExpired(): void {
  sessionExpiredHandler?.();
}
