/**
 * Canonical form of a request path for security decisions (write blocks, traffic classes).
 *
 * Express route matching is case-insensitive and tolerant of a trailing slash, so a policy that
 * compares the raw path can be sidestepped with `/API/ME/...` while the route still matches.
 * Every path-based policy must compare against this normalised form instead.
 */
export function normalizeRequestPathForPolicy(rawPathOrUrl: string): string {
  const pathOnly = (rawPathOrUrl.split(/[?#]/)[0] ?? "").replace(/\\/g, "/");
  const collapsed = pathOnly.replace(/\/{2,}/g, "/").toLowerCase();
  const trimmed = collapsed.replace(/\/+$/, "");
  return trimmed || "/";
}
