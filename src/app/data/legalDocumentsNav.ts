/** Shared legal document routes for public policy pages. */
export const LEGAL_DOCUMENT_ROUTES = [
  { id: "terms", path: "/terms" },
  { id: "privacy", path: "/privacy" },
  { id: "cookies", path: "/cookies" },
  { id: "imprint", path: "/imprint" },
] as const;

export type LegalDocumentId = (typeof LEGAL_DOCUMENT_ROUTES)[number]["id"];
