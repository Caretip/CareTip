import { LegalDocumentType } from "@prisma/client";
import { prisma } from "../prisma.js";
import { getLatestLegalDocument } from "../services/legalDocument.service.js";
import { StripeConnectError } from "../services/stripeConnect.service.js";

export const INSTANT_PAYOUT_TERMS_PATH = "/terms" as const;
export const INSTANT_PAYOUT_TERMS_CONTEXT_EMPLOYEE = "instant_payout_employee" as const;
export const INSTANT_PAYOUT_TERMS_CONTEXT_BUSINESS = "instant_payout_business" as const;
/** Used only when no LegalDocument row exists; still version-gated and recorded. */
export const INSTANT_PAYOUT_TERMS_FALLBACK_VERSION = "caretip.terms_conditions.current";

export type InstantPayoutTermsContext =
  | typeof INSTANT_PAYOUT_TERMS_CONTEXT_EMPLOYEE
  | typeof INSTANT_PAYOUT_TERMS_CONTEXT_BUSINESS;

export type InstantPayoutTermsRequirement = {
  documentType: "terms_conditions";
  version: string;
  language: string;
  path: typeof INSTANT_PAYOUT_TERMS_PATH;
  context: InstantPayoutTermsContext;
};

const TERMS_REQUIRED_MSG =
  "Please accept the Instant Payout Terms and Conditions before continuing.";
const TERMS_STALE_MSG =
  "These Instant Payout Terms have been updated. Please review and accept the current version.";

export function languageFromRequest(req: {
  query?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const q = req.query?.lang ?? req.query?.language ?? req.query?.locale;
  if (typeof q === "string" && q.trim()) return q.trim().slice(0, 2).toLowerCase();
  const accept = req.headers?.["accept-language"];
  if (typeof accept === "string") {
    const first = accept.split(",")[0]?.trim();
    if (first) return first.slice(0, 2).toLowerCase();
  }
  return "en";
}

export async function getInstantPayoutTermsRequirement(
  context: InstantPayoutTermsContext,
  language?: string,
): Promise<InstantPayoutTermsRequirement> {
  const lang = (language ?? "en").trim().slice(0, 2).toLowerCase() || "en";
  const doc = await getLatestLegalDocument(LegalDocumentType.terms_conditions, lang);
  return {
    documentType: "terms_conditions",
    version: doc?.version?.trim() || INSTANT_PAYOUT_TERMS_FALLBACK_VERSION,
    language: doc?.language || lang,
    path: INSTANT_PAYOUT_TERMS_PATH,
    context,
  };
}

export function parseSubmittedTermsVersion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const version = raw.trim();
  if (!version || version.length > 64) return null;
  return version;
}

export async function assertAndRecordInstantPayoutTerms(args: {
  userId: string;
  context: InstantPayoutTermsContext;
  submittedVersion: unknown;
  language?: string;
  idempotencyKey?: string;
}): Promise<InstantPayoutTermsRequirement> {
  const required = await getInstantPayoutTermsRequirement(args.context, args.language);
  const submitted = parseSubmittedTermsVersion(args.submittedVersion);
  if (!submitted) {
    throw new StripeConnectError(TERMS_REQUIRED_MSG, "INSTANT_PAYOUT_TERMS_REQUIRED", 400);
  }
  if (submitted !== required.version) {
    throw new StripeConnectError(TERMS_STALE_MSG, "INSTANT_PAYOUT_TERMS_VERSION_STALE", 409);
  }

  await prisma.auditLog.create({
    data: {
      userId: args.userId,
      action: "instant_payout_terms_accepted",
      metadata: JSON.stringify({
        context: required.context,
        legalType: required.documentType,
        legalVersion: required.version,
        legalLanguage: required.language,
        path: required.path,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
    },
  });

  return required;
}

export async function withInstantPayoutTerms<T extends object>(
  eligibility: T,
  context: InstantPayoutTermsContext,
  language?: string,
): Promise<T & { terms: InstantPayoutTermsRequirement }> {
  const terms = await getInstantPayoutTermsRequirement(context, language);
  return { ...eligibility, terms };
}
