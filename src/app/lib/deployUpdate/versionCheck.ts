import { isValidDeployVersion } from "./buildInfo";

export const DEPLOY_VERSION_URL = "/version.json";
export const DEPLOY_VERSION_TIMEOUT_MS = 8_000;

export type DeployVersionCheckFailure = "network" | "timeout" | "http" | "invalid";

export type DeployVersionCheckResult =
  | { ok: true; version: string; buildTime: string | null }
  | { ok: false; reason: DeployVersionCheckFailure; status?: number };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Reads the deployed version with HTTP caching disabled. Never throws: every failure is a typed
 * result so callers cannot mistake an outage for a new deployment.
 */
export async function fetchDeployedVersion(options: {
  fetchImpl: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  url?: string;
}): Promise<DeployVersionCheckResult> {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEPLOY_VERSION_TIMEOUT_MS;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller?.abort();
  }, timeoutMs);

  try {
    const res = await options.fetchImpl(`${options.url ?? DEPLOY_VERSION_URL}?t=${now()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller?.signal,
    });
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    let body: unknown;
    try {
      body = JSON.parse(await res.text());
    } catch {
      return { ok: false, reason: "invalid" };
    }
    if (!body || typeof body !== "object") return { ok: false, reason: "invalid" };
    const { version, buildTime } = body as { version?: unknown; buildTime?: unknown };
    if (!isValidDeployVersion(version)) return { ok: false, reason: "invalid" };
    const parsedTime =
      typeof buildTime === "string" && !Number.isNaN(Date.parse(buildTime)) ? buildTime : null;
    return { ok: true, version, buildTime: parsedTime };
  } catch {
    return { ok: false, reason: timedOut ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
