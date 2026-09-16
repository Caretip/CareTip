import { LegalDocumentType } from "@prisma/client";
import { prisma } from "../prisma.js";
import { getLatestLegalDocument } from "../services/legalDocument.service.js";
import {
  CARETIP_PLV_VALID_FROM,
  careTipControlledPdfSha256,
  getCareTipControlledLegalDocMeta,
} from "./caretipControlledLegalDocs.js";

export const MERCHANT_LEGAL_ACCEPTANCE_ACTION = "merchant_b2b_legal_accepted" as const;

export const MERCHANT_LEGAL_ACCEPTANCE_REQUIRED_MSG =
  "Please accept the Terms of Service, the Data Processing Agreement (DPA), the Price & Services List, and acknowledge the Privacy Policy before continuing.";

export const MERCHANT_LEGAL_ACCEPTANCE_CONTEXT = {
  signup: "merchant_signup",
  oauth_signup: "merchant_oauth_signup",
  billing_checkout: "merchant_billing_checkout",
} as const;

export type MerchantLegalAcceptanceContext =
  (typeof MERCHANT_LEGAL_ACCEPTANCE_CONTEXT)[keyof typeof MERCHANT_LEGAL_ACCEPTANCE_CONTEXT];

export type MerchantLegalDocumentSnapshot = {
  termsPath: "/terms";
  privacyPath: "/privacy";
  dpaPath: "/avv";
  plvPath: "/plv";
  termsVersion: string;
  privacyVersion: string;
  /** Content hash of the supplied AVV PDF — not an invented legal version string. */
  dpaContentSha256: string;
  plvContentSha256: string;
  /** From PLV template: Valid from August 2026. */
  plvValidFrom: string;
};

const TERMS_FALLBACK_VERSION = "caretip.terms_conditions.current";
const PRIVACY_FALLBACK_VERSION = "caretip.privacy_policy.current";

export class MerchantLegalAcceptanceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "MerchantLegalAcceptanceError";
    this.code = code;
    this.status = status;
  }
}

export function parseMerchantLegalAcceptedFlag(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === 1 || raw === "1";
}

export async function getMerchantLegalDocumentSnapshot(
  language?: string,
): Promise<MerchantLegalDocumentSnapshot> {
  const lang = (language ?? "de").trim().slice(0, 2).toLowerCase() || "de";
  const [terms, privacy] = await Promise.all([
    getLatestLegalDocument(LegalDocumentType.terms_conditions, lang),
    getLatestLegalDocument(LegalDocumentType.privacy_policy, lang),
  ]);
  const avv = getCareTipControlledLegalDocMeta("avv", lang);
  const plv = getCareTipControlledLegalDocMeta("plv", lang);
  return {
    termsPath: "/terms",
    privacyPath: "/privacy",
    dpaPath: "/avv",
    plvPath: "/plv",
    termsVersion: terms?.version?.trim() || TERMS_FALLBACK_VERSION,
    privacyVersion: privacy?.version?.trim() || PRIVACY_FALLBACK_VERSION,
    dpaContentSha256: avv.contentSha256 || careTipControlledPdfSha256("avv", lang),
    plvContentSha256: plv.contentSha256 || careTipControlledPdfSha256("plv", lang),
    plvValidFrom: plv.validFrom || CARETIP_PLV_VALID_FROM,
  };
}

export async function hasMerchantLegalAcceptance(userId: string): Promise<boolean> {
  const row = await prisma.auditLog.findFirst({
    where: { userId, action: MERCHANT_LEGAL_ACCEPTANCE_ACTION },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  return Boolean(row);
}

export async function assertAndRecordMerchantLegalAcceptance(args: {
  userId: string;
  accepted: unknown;
  context: MerchantLegalAcceptanceContext;
  language?: string;
  businessId?: string | null;
}): Promise<MerchantLegalDocumentSnapshot> {
  if (!parseMerchantLegalAcceptedFlag(args.accepted)) {
    throw new MerchantLegalAcceptanceError(
      MERCHANT_LEGAL_ACCEPTANCE_REQUIRED_MSG,
      "MERCHANT_LEGAL_ACCEPTANCE_REQUIRED",
      400,
    );
  }

  const snapshot = await getMerchantLegalDocumentSnapshot(args.language);

  await prisma.auditLog.create({
    data: {
      userId: args.userId,
      action: MERCHANT_LEGAL_ACCEPTANCE_ACTION,
      metadata: JSON.stringify({
        context: args.context,
        businessId: args.businessId ?? null,
        termsPath: snapshot.termsPath,
        privacyPath: snapshot.privacyPath,
        dpaPath: snapshot.dpaPath,
        plvPath: snapshot.plvPath,
        termsVersion: snapshot.termsVersion,
        privacyVersion: snapshot.privacyVersion,
        dpaContentSha256: snapshot.dpaContentSha256,
        plvContentSha256: snapshot.plvContentSha256,
        plvValidFrom: snapshot.plvValidFrom,
        acceptedAt: new Date().toISOString(),
      }),
    },
  });

  return snapshot;
}

/**
 * For checkout: allow if prior acceptance exists; otherwise require accepted flag and record.
 */
export async function requireMerchantLegalAcceptanceForCheckout(args: {
  userId: string;
  accepted: unknown;
  language?: string;
  businessId?: string | null;
}): Promise<MerchantLegalDocumentSnapshot | null> {
  if (await hasMerchantLegalAcceptance(args.userId)) {
    return null;
  }
  return assertAndRecordMerchantLegalAcceptance({
    userId: args.userId,
    accepted: args.accepted,
    context: MERCHANT_LEGAL_ACCEPTANCE_CONTEXT.billing_checkout,
    language: args.language,
    businessId: args.businessId,
  });
}
