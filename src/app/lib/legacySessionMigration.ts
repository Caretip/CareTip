/**
 * One-time move of an existing browser session from the previous API host to the current one.
 *
 * A refresh cookie is bound to the host that set it, so after the API hostname changes the new
 * host sees no cookie. When that happens for a browser that had a session, this:
 *   1. refreshes once against the previous host (rotating its cookie, receiving an access token);
 *   2. calls `POST /api/auth/session/migrate` on the current host with that access token, which
 *      revokes the old session and sets a refresh cookie for the current host.
 * No token is ever written to storage; the only persisted value is a completion marker.
 * Runs inside the cross-tab refresh critical section, so tabs never migrate concurrently.
 */
import { resolveApiBaseUrl, resolveLegacyApiBaseUrl } from "./apiOrigin";
import { hasClientStoredSession } from "./authUserStore";
import { AUTH_REFRESH_PATHNAME } from "./pageOriginAuthRefresh";

export const LEGACY_SESSION_MIGRATION_STORAGE_KEY = "caretip_api_host_migration";
export const SESSION_MIGRATE_PATHNAME = "/api/auth/session/migrate";

export type LegacySessionMigrationResult =
  | { kind: "migrated"; data: unknown }
  /** Old-host session works but the move did not complete; retried on a later refresh. */
  | { kind: "legacy_only"; data: unknown }
  | { kind: "no_session" }
  | { kind: "transient"; status: number };

function markDone(): void {
  try {
    localStorage.setItem(LEGACY_SESSION_MIGRATION_STORAGE_KEY, "done");
  } catch {
    /* private mode */
  }
}

export function isLegacySessionMigrationDone(): boolean {
  try {
    return localStorage.getItem(LEGACY_SESSION_MIGRATION_STORAGE_KEY) === "done";
  } catch {
    return true;
  }
}

/** Only browsers that had a session, while the previous host is configured, and only once. */
export function shouldAttemptLegacySessionMigration(): boolean {
  if (!resolveLegacyApiBaseUrl()) return false;
  if (isLegacySessionMigrationDone()) return false;
  return hasClientStoredSession();
}

/** The current host issued a cookie for this browser — nothing left to migrate. */
export function noteCurrentHostSessionEstablished(): void {
  if (resolveLegacyApiBaseUrl()) markDone();
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (err instanceof DOMException && err.name === "AbortError");
}

function readToken(data: unknown): string | null {
  const t = (data as { token?: unknown } | null)?.token;
  return typeof t === "string" && t.trim() ? t : null;
}

const CLIENT_HEADERS = { "Content-Type": "application/json", "X-CareTip-Client": "1" };

function postJson(url: string, signal?: AbortSignal, headers: Record<string, string> = CLIENT_HEADERS): Promise<Response> {
  return fetch(url, { method: "POST", headers, body: "{}", credentials: "include", signal });
}

/** Current host refresh after an uncertain move: the new cookie may already be in the jar. */
async function currentHostSession(currentBase: string, signal?: AbortSignal): Promise<unknown | null> {
  try {
    const res = await postJson(`${currentBase}${AUTH_REFRESH_PATHNAME}`, signal);
    if (!res.ok) return null;
    const data: unknown = await res.json().catch(() => null);
    return readToken(data) ? data : null;
  } catch {
    return null;
  }
}

export async function migrateLegacySession(signal?: AbortSignal): Promise<LegacySessionMigrationResult> {
  const legacyBase = resolveLegacyApiBaseUrl();
  const currentBase = resolveApiBaseUrl();
  if (!legacyBase || !currentBase) return { kind: "no_session" };

  let lastLegacyData: unknown = null;
  // Second pass only after an uncertain move (lost response / concurrent move): the server links
  // the old session to the new one, so the old host's refresh grace window lets it be redone once.
  for (let attempt = 0; attempt < 2; attempt++) {
    let legacyRes: Response;
    try {
      legacyRes = await postJson(`${legacyBase}${AUTH_REFRESH_PATHNAME}`, signal);
    } catch (err) {
      if (lastLegacyData) return { kind: "legacy_only", data: lastLegacyData };
      return { kind: "transient", status: isAbort(err, signal) ? 504 : 0 };
    }
    if (legacyRes.status === 401 || legacyRes.status === 403) {
      markDone();
      return { kind: "no_session" };
    }
    if (!legacyRes.ok) {
      if (lastLegacyData) return { kind: "legacy_only", data: lastLegacyData };
      return { kind: "transient", status: legacyRes.status };
    }
    const legacyData: unknown = await legacyRes.json().catch(() => null);
    const legacyToken = readToken(legacyData);
    if (!legacyToken) return { kind: "transient", status: 502 };
    lastLegacyData = legacyData;

    let moveRes: Response | null = null;
    try {
      moveRes = await postJson(`${currentBase}${SESSION_MIGRATE_PATHNAME}`, signal, {
        ...CLIENT_HEADERS,
        Authorization: `Bearer ${legacyToken}`,
      });
    } catch (err) {
      if (isAbort(err, signal)) return { kind: "legacy_only", data: legacyData };
    }
    if (moveRes?.ok) {
      const moved: unknown = await moveRes.json().catch(() => null);
      if (readToken(moved)) {
        markDone();
        return { kind: "migrated", data: moved };
      }
      return { kind: "legacy_only", data: legacyData };
    }
    if (moveRes && (moveRes.status === 401 || moveRes.status === 403)) {
      markDone();
      return { kind: "no_session" };
    }
    if (moveRes && moveRes.status !== 409) {
      // Server could not move the session (e.g. 503) and did not revoke it: keep using it.
      return { kind: "legacy_only", data: legacyData };
    }
    // No response, or another request moved this session first.
    const current = await currentHostSession(currentBase, signal);
    if (current) {
      markDone();
      return { kind: "migrated", data: current };
    }
  }
  return { kind: "legacy_only", data: lastLegacyData };
}
