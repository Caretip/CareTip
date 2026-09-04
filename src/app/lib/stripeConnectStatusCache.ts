import { getConnectStatus, type ConnectStatus } from "./api";

const TTL_MS = 30_000;

let cache: { at: number; data: ConnectStatus } | null = null;
let inflight: Promise<ConnectStatus> | null = null;

export function readConnectStatusSnapshot(): ConnectStatus | null {
  if (!cache) return null;
  if (Date.now() - cache.at > TTL_MS) return cache.data;
  return cache.data;
}

export async function fetchConnectStatusCached(opts?: { revalidate?: boolean }): Promise<ConnectStatus> {
  if (!opts?.revalidate && cache && Date.now() - cache.at < TTL_MS) {
    return cache.data;
  }
  if (inflight) return inflight;
  inflight = getConnectStatus()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
