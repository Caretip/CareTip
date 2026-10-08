/**
 * Bounds credential-exchange POSTs (register, password login, OAuth, MFA verify).
 * Duration matches the sign-in handoff cover (`HANDOFF_MAX_MS`, 20s): long enough
 * for a cold mobile API, short enough that a pending fetch cannot trap the form.
 * Refresh-session timeouts are unchanged.
 */
import { API_WAKEUP_NETWORK_MESSAGE, isAbortError } from "./errorMessages";
import { getSignInHandoffMaxMs } from "./authSignInHandoff";

export function getAuthCredentialExchangeTimeoutMs(): number {
  return getSignInHandoffMaxMs();
}

export async function withAuthCredentialExchangeDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = getAuthCredentialExchangeTimeoutMs(),
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(API_WAKEUP_NETWORK_MESSAGE));
    }, timeoutMs);
  });

  const work = run(controller.signal);
  void work.catch(() => undefined);

  try {
    return await Promise.race([work, deadline]);
  } catch (err) {
    if (timedOut || isAbortError(err)) {
      throw new Error(API_WAKEUP_NETWORK_MESSAGE);
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * If AuthPage is still mounted with a redirect pending after the handoff window,
 * the destination never committed. Caller clears the form busy flag.
 */
export function scheduleAuthNavigationRecovery(options: {
  delayMs: number;
  isRedirectPending: () => boolean;
  onRecover: () => void;
}): () => void {
  const timer = setTimeout(() => {
    if (!options.isRedirectPending()) return;
    options.onRecover();
  }, options.delayMs);
  return () => clearTimeout(timer);
}

/** Facebook start: fail only when the document never left this page. */
export function shouldFailFacebookStartForStall(input: {
  navigationLeft: boolean;
  failureHandled: boolean;
}): boolean {
  return !input.navigationLeft && !input.failureHandled;
}
