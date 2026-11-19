/**
 * In-app destination check for links that come from stored data (notification URLs).
 * Returns the normalized path, query and hash when the link stays on this CareTip origin,
 * otherwise null. Rejects other hosts, protocol-relative `//host`, backslashes, control
 * characters, encoded `//` tricks and non-http schemes such as `javascript:` or `data:`.
 */
/** Control characters (U+0000 to U+001F, U+007F) or a backslash. */
function hasUnsafeCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

export function toSafeInternalPath(raw: unknown, origin?: string): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 2048) return null;
  if (hasUnsafeCharacter(value)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(decodeURIComponent(value));
  } catch {
    return null;
  }
  if (hasUnsafeCharacter(decoded)) return null;
  const appOrigin = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  if (!appOrigin) return null;
  const isPath = value.startsWith("/") && !value.startsWith("//") && !decoded.startsWith("//");
  if (!isPath && !/^https?:\/\//i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, `${appOrigin}/`);
  } catch {
    return null;
  }
  if (url.origin !== new URL(appOrigin).origin || url.username || url.password) return null;
  if (url.pathname.startsWith("//")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
