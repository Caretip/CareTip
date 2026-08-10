/**
 * Monotonic session epoch — bumped whenever a new access session is established
 * (login, MFA, OAuth, bootstrap restore). Used so in-flight refresh failures from
 * a prior generation cannot clear tokens or show "sign in again" after a successful login.
 */

let authSessionEpoch = 0;

export function bumpAuthSessionEpoch(): number {
  authSessionEpoch += 1;
  return authSessionEpoch;
}

export function getAuthSessionEpoch(): number {
  return authSessionEpoch;
}
