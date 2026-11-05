import { PRIVATE_IPV4 } from "../emails/loginAlertFormat.js";

type GeoLocale = "en" | "de";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { label: string; expiresAt: number }>();

function localNetworkLabel(locale: GeoLocale): string {
  return locale === "de" ? "Lokales oder privates Netzwerk" : "Local or private network";
}

function unknownLocationLabel(locale: GeoLocale): string {
  return locale === "de" ? "Unbekannter Standort" : "Unknown location";
}

function isPrivateOrLocalIp(ip: string): boolean {
  return ip === "::1" || ip === "127.0.0.1" || PRIVATE_IPV4.test(ip);
}

/**
 * Resolves a user-facing location label (city, country) — never returns a raw IP.
 */
export async function resolveLoginLocationLabel(
  ip: string | null | undefined,
  locale: GeoLocale,
): Promise<string> {
  const raw = ip?.trim();
  if (!raw) return unknownLocationLabel(locale);
  if (isPrivateOrLocalIp(raw)) return localNetworkLabel(locale);
  // Sends the address to a third party, so it needs a deliberate decision and a processor agreement.
  if (process.env.LOGIN_GEO_LOOKUP_ENABLED !== "true") return unknownLocationLabel(locale);

  const cached = cache.get(raw);
  if (cached && cached.expiresAt > Date.now()) return cached.label;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_500);
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(raw)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error("geo_http_error");
    const data = (await r.json()) as {
      success?: boolean;
      city?: string;
      country?: string;
    };
    if (!data.success) throw new Error("geo_miss");

    const city = data.city?.trim();
    const country = data.country?.trim();
    let label: string;
    if (city && country) label = `${city}, ${country}`;
    else if (country) label = country;
    else if (city) label = city;
    else throw new Error("geo_empty");

    cache.set(raw, { label, expiresAt: Date.now() + CACHE_TTL_MS });
    return label;
  } catch {
    return unknownLocationLabel(locale);
  }
}
