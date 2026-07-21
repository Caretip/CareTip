/**
 * Auth / routing debug logs (Vite DEV builds only).
 */
const PREFIX = "[CareTip:auth]";

export function authDebug(message: string, data?: Record<string, unknown>): void {
  try {
    const dev =
      typeof import.meta !== "undefined" && import.meta.env && (import.meta.env as { DEV?: boolean }).DEV === true;
    // Production builds must not ship opt-in auth debug logging.
    if (!dev) return;
    if (data && Object.keys(data).length > 0) {
      console.log(PREFIX, message, data);
    } else {
      console.log(PREFIX, message);
    }
  } catch {
    // ignore (SSR / privacy mode)
  }
}
