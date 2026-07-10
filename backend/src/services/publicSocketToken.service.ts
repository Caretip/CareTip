import { signJwt, verifyJwt } from "../lib/jwtConfig.js";

const PURPOSE = "public_socket_room";
const DEFAULT_TTL_SEC = 5 * 60;

export type PublicSocketTokenPayload = {
  businessId: string;
  purpose: typeof PURPOSE;
};

export function signPublicSocketRoomToken(
  businessId: string,
  ttlSec = DEFAULT_TTL_SEC,
): { token: string; expiresAt: string } {
  const expiresAt = new Date(Date.now() + ttlSec * 1000);
  const token = signJwt(
    { businessId, purpose: PURPOSE } satisfies PublicSocketTokenPayload,
    ttlSec,
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

export function businessIdFromPublicSocketRoomToken(token: string): string | null {
  if (!token.trim()) return null;
  try {
    const decoded = verifyJwt<PublicSocketTokenPayload>(token.trim());
    if (decoded.purpose !== PURPOSE) return null;
    if (typeof decoded.businessId !== "string" || !decoded.businessId.trim()) return null;
    return decoded.businessId.trim();
  } catch {
    return null;
  }
}
