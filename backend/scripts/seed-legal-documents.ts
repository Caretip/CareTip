/**
 * Dev/bootstrap seed for legal documents when the provider webhook has not run yet.
 * Usage (from backend/): npx tsx scripts/seed-legal-documents.ts
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { upsertLegalDocument } from "../src/services/legalDocument.service.js";

const PLACEHOLDER_HTML = (title: string) =>
  `<h1>${title}</h1><p>This document will be updated automatically when published by our legal provider.</p>`;

async function main(): Promise<void> {
  const docs = [
    {
      type: "privacy_policy",
      language: "en",
      title: "Privacy Policy",
      contentHtml: PLACEHOLDER_HTML("Privacy Policy"),
      version: "bootstrap-1",
    },
    {
      type: "terms_conditions",
      language: "en",
      title: "Terms & Conditions",
      contentHtml: PLACEHOLDER_HTML("Terms & Conditions"),
      version: "bootstrap-1",
    },
    {
      type: "impressum",
      language: "de",
      title: "Impressum",
      contentHtml: PLACEHOLDER_HTML("Impressum"),
      version: "bootstrap-1",
    },
  ] as const;

  for (const doc of docs) {
    const result = await upsertLegalDocument(doc);
    console.log(`✓ ${result.type} (${result.language}) v${result.version}`);
  }

  const count = await prisma.legalDocument.count();
  console.log(`Legal documents in database: ${count}`);
}

main()
  .catch((err) => {
    console.error("seed-legal-documents failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
