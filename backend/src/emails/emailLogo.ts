/**
 * CareTip logo for transactional emails (inline CID attachment).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Must match `<img src="cid:…">` in emailBrandMark. */
export const CARETIP_EMAIL_LOGO_CID = "caretip-logo";

const LOGO_FILENAME = "caretip-logo-primary.png";

function candidateLogoPaths(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cwd = process.cwd();
  return [
    path.join(cwd, "assets", "email", LOGO_FILENAME),
    path.join(here, "..", "..", "assets", "email", LOGO_FILENAME), // src/emails → backend/
    path.join(here, "..", "..", "..", "assets", "email", LOGO_FILENAME), // dist/emails → backend/
    path.join(cwd, "..", "public", "brand", LOGO_FILENAME),
  ];
}

export function resolveCareTipEmailLogoPath(): string | null {
  for (const p of candidateLogoPaths()) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Hosted fallback when the PNG is not on disk (e.g. misconfigured deploy). */
export function resolveCareTipEmailLogoRemoteUrl(): string | null {
  const origin = (
    process.env.FRONTEND_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VITE_APP_URL ||
    process.env.BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  if (origin) return `${origin}/brand/${LOGO_FILENAME}`;
  if (process.env.NODE_ENV === "production") {
    return `https://caretip.de/brand/${LOGO_FILENAME}`;
  }
  return null;
}

export type CareTipEmailLogoAttachment = {
  filename: string;
  content_id: string;
  content?: string;
  path?: string;
  content_type: string;
};

/**
 * Resend inline attachment for the brand mark. Prefer local base64; else remote path.
 */
export function getCareTipEmailLogoAttachment(): CareTipEmailLogoAttachment | null {
  const local = resolveCareTipEmailLogoPath();
  if (local) {
    return {
      filename: LOGO_FILENAME,
      content_id: CARETIP_EMAIL_LOGO_CID,
      content_type: "image/png",
      content: readFileSync(local).toString("base64"),
    };
  }
  const remote = resolveCareTipEmailLogoRemoteUrl();
  if (remote) {
    return {
      filename: LOGO_FILENAME,
      content_id: CARETIP_EMAIL_LOGO_CID,
      content_type: "image/png",
      path: remote,
    };
  }
  return null;
}
