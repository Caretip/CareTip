import i18n from "i18next";
import { resolveApiBaseUrl } from "./apiOrigin";

export type LeadSubmitResult = { ok: true } | { ok: false; message: string };

function leadApiUrl(path: string): string {
  const base = resolveApiBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

async function postLead(
  path: string,
  body: Record<string, unknown>,
  fallbackEmail: string,
): Promise<LeadSubmitResult> {
  try {
    const res = await fetch(leadApiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        locale: i18n.language?.slice(0, 2) || "en",
      }),
    });

    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) {
      return {
        ok: false,
        message: data.message || `Something went wrong. Please email ${fallbackEmail}.`,
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: `Unable to reach the server. Please email ${fallbackEmail}.`,
    };
  }
}

export function submitDemoLead(fields: {
  fullName: string;
  workEmail: string;
  businessName: string;
  businessType: string;
  teamSize: string;
  message: string;
}): Promise<LeadSubmitResult> {
  return postLead("/api/leads/demo", fields, "info@caretip.de");
}

export function submitSupportLead(fields: {
  name: string;
  email: string;
  category: string;
  message: string;
}): Promise<LeadSubmitResult> {
  return postLead("/api/leads/support", fields, "support@caretip.de");
}
