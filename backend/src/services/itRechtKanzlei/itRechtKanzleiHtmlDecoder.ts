/** Decode IT-Recht rechtstext_html (URL-encoded per spec; XML entities may already be resolved). */
export function decodeItRechtHtml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  let decoded = trimmed;
  if (decoded.includes("%")) {
    try {
      decoded = decodeURIComponent(decoded.replace(/\+/g, " "));
    } catch {
      decoded = trimmed;
    }
  }

  return decoded;
}
