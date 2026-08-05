import { isOnline } from "@/utils/network";

/**
 * Preflight for mutations that are not queued offline.
 * Returns false when offline so callers can toast and avoid a stuck isPending spinner.
 */
export async function requireOnline(): Promise<boolean> {
  return isOnline();
}
