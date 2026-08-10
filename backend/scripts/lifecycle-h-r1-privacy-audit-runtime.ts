/**
 * H-R1 — Audit hosted Privacy Policy HTML against Slice H behavioral claims.
 * Run: npm run test:lifecycle-h-r1-privacy-audit (from backend/)
 *
 * Does NOT invent or independently approve legal wording.
 * Does NOT mutate LegalDocument rows.
 * Reports discrepancies; exits non-zero only when overclaim phrases are detected
 * in hosted content (so CI surfaces the conflict). Owner/legal must approve any
 * replacement text before applying via IT-Recht webhook / legal update path.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/prisma.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);
const info = (m: string) => results.push(`INFO: ${m}`);

/** Phrases that conflict with Slice H / lifecycle reality (case-insensitive). */
const OVERCLAIM_PATTERNS: Array<{ id: string; re: RegExp; why: string }> = [
  {
    id: "full-control-always",
    re: /full control over (their|your|our users['']?) data at all times/i,
    why: "Overclaims absolute control; financial retention and blockers exist (Slice H).",
  },
  {
    id: "jederzeit-volle-kontrolle",
    re: /jederzeit volle kontrolle/i,
    why: "DE overclaim equivalent of absolute control (Slice H).",
  },
  {
    id: "all-data-deleted-immediately",
    re: /all (personal )?data (is |are |will be )?(deleted|erased|removed) immediately/i,
    why: "False immediacy; tip/payment records may be retained in limited form.",
  },
  {
    id: "sofort-alle-daten-gelöscht",
    re: /alle (personenbezogenen )?daten (werden |sind )?sofort (gelöscht|entfernt)/i,
    why: "DE false immediacy claim.",
  },
  {
    id: "right-to-erasure-wipes-tips",
    re: /right to erasure.{0,80}(tip|payment|transaction).{0,40}(delet|eras|wip)/i,
    why: "Must not imply Art. 17 wipes tip ledger for the venue.",
  },
  {
    id: "gdpr-guarantees-complete-deletion",
    re: /gdpr guarantees.{0,40}(complete|full|total).{0,20}(deletion|erasure)/i,
    why: "Unsupported absolute GDPR guarantee.",
  },
  {
    id: "clear-retention-policies-years",
    re: /clear retention polic(y|ies).{0,60}(\d+\s*(year|month|day)|years|months)/i,
    why: "Must not invent specific retention durations (T_* UNSET).",
  },
];

/** Soft gaps — do not fail CI; require owner/legal to decide whether to amend hosted text. */
const SOFT_GAP_PATTERNS: Array<{ id: string; re: RegExp; why: string }> = [
  {
    id: "account-deletion-data-deleted-generic",
    re: /nach l[öo]schung.{0,40}kundenkontos werden ihre daten gel[öo]scht/i,
    why:
      "Generic account-deletion deletion promise; does not explicitly distinguish CareTip tip/payment ledger retention or staff membership removal vs Art. 17. REQUIRES OWNER/LEGAL to clarify CareTip-specific wording.",
  },
  {
    id: "art17-listed-without-tip-caveat-nearby",
    re: /recht auf l[öo]schung gem[äa]ß art\.\s*17/i,
    why:
      "Art. 17 is correctly listed as a right, but hosted HTML may lack CareTip-specific tip-ledger / financial retention caveats near account-deletion sections. REQUIRES OWNER/LEGAL review for product-specific accuracy.",
  },
];

/** Expected conservative themes (informational if missing — requires legal to add). */
const EXPECTED_THEMES: Array<{ id: string; re: RegExp; note: string }> = [
  {
    id: "export-or-access",
    re: /export|access request|right of access|auskunft|datenexport/i,
    note: "Should mention access/export rights.",
  },
  {
    id: "limited-retention-or-legal",
    re: /retain|retention|legal obligat|gesetzlich|aufbewahr|financial|zahlungs|trinkgeld/i,
    note: "Should acknowledge some records may be retained where required.",
  },
];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

type Finding = {
  language: string;
  version: string;
  patternId: string;
  why: string;
  snippet: string;
  requiresOwnerLegalApproval: true;
};

async function main() {
  const docs = await prisma.legalDocument.findMany({
    where: { type: "privacy_policy" },
    select: {
      language: true,
      title: true,
      version: true,
      updatedAt: true,
      contentHtml: true,
    },
  });

  if (docs.length === 0) {
    info("No privacy_policy LegalDocument rows in DB (provider content not synced yet).");
    info("H-R1 audit cannot compare live HTML — discrepancy list will use Slice H checklist only.");
    pass("empty-db: audit completes without mutating content");
  } else {
    pass(`loaded ${docs.length} privacy_policy document(s) from LegalDocument`);
  }

  const findings: Finding[] = [];
  const softGaps: Finding[] = [];
  const missingThemes: Array<{ language: string; themeId: string; note: string }> = [];

  for (const doc of docs) {
    const text = stripHtml(doc.contentHtml);
    info(`auditing language=${doc.language} version=${doc.version} title=${doc.title}`);

    for (const p of OVERCLAIM_PATTERNS) {
      const m = text.match(p.re);
      if (m) {
        const idx = m.index ?? 0;
        const snippet = text.slice(Math.max(0, idx - 40), idx + (m[0]?.length ?? 0) + 40);
        findings.push({
          language: doc.language,
          version: doc.version,
          patternId: p.id,
          why: p.why,
          snippet,
          requiresOwnerLegalApproval: true,
        });
        fail(`overclaim [${p.id}] in ${doc.language}: ${p.why}`);
      }
    }

    for (const p of SOFT_GAP_PATTERNS) {
      const m = text.match(p.re);
      if (m) {
        const idx = m.index ?? 0;
        const snippet = text.slice(Math.max(0, idx - 40), idx + (m[0]?.length ?? 0) + 80);
        softGaps.push({
          language: doc.language,
          version: doc.version,
          patternId: p.id,
          why: p.why,
          snippet,
          requiresOwnerLegalApproval: true,
        });
        info(`soft-gap [${p.id}] in ${doc.language}: ${p.why}`);
      }
    }

    for (const t of EXPECTED_THEMES) {
      if (!t.re.test(text)) {
        missingThemes.push({ language: doc.language, themeId: t.id, note: t.note });
        info(`missing recommended theme [${t.id}] in ${doc.language}: ${t.note}`);
      }
    }
  }

  const languages = new Set(docs.map((d) => d.language.toLowerCase()));
  if (docs.length > 0 && !languages.has("en")) {
    softGaps.push({
      language: "en",
      version: "n/a",
      patternId: "missing-en-privacy-document",
      why: "Only non-EN privacy_policy found in LegalDocument. EN /privacy may be empty or fallback. REQUIRES OWNER/LEGAL to publish EN text if required.",
      snippet: "",
      requiresOwnerLegalApproval: true,
    });
    info("soft-gap: EN privacy_policy document missing in DB");
  }

  // Also scan static FAQ GDPR answers already aligned in Slice H (should pass).
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, "../..");
  try {
    const en = JSON.parse(
      await import("node:fs").then((fs) =>
        fs.readFileSync(path.join(root, "src/i18n/locales/en.json"), "utf8"),
      ),
    ) as { staticPages: { faq: { items: Array<{ q: string; a: string }> } } };
    const faq = en.staticPages.faq.items.find((i) => /gdpr/i.test(i.q))?.a ?? "";
    if (/full control over their data at all times/i.test(faq)) {
      fail("static FAQ EN still has full-control overclaim");
    } else pass("static FAQ EN aligned with Slice H (no full-control overclaim)");
  } catch {
    info("could not load static FAQ for cross-check");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "AUDIT_ONLY",
    documentsAudited: docs.map((d) => ({
      language: d.language,
      version: d.version,
      title: d.title,
      updatedAt: d.updatedAt.toISOString(),
    })),
    overclaimFindings: findings,
    softGapFindings: softGaps,
    missingRecommendedThemes: missingThemes,
    proposedRemediationNotes: [
      {
        requiresOwnerLegalApproval: true,
        action: "Do not auto-edit LegalDocument.contentHtml from this script.",
        guidance:
          "If overclaims are listed, counsel/IT-Recht should publish revised Datenschutz HTML that: (1) avoids absolute control/immediate deletion claims; (2) distinguishes staff removal from Art. 17; (3) notes tip/payment records may be retained in limited form where required; (4) does not invent retention years while T_* are UNSET.",
      },
    ],
    sliceHBehavioralTruths: [
      "Manager staff remove = membership removal; tips retained for venue.",
      "Account erasure revokes access; does not promise immediate wipe of all records.",
      "MVP export-before-deletion confirmation.",
      "KYC not required for current MVP dashboard access.",
      "No invented T_* retention periods in product copy.",
    ],
  };

  const outDir = path.join(root, "docs");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "GDPR_LIFECYCLE_H_R1_PRIVACY_POLICY_DISCREPANCY_LIST.md");
  const md = [
    "# H-R1 — Hosted Privacy Policy discrepancy list",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "**Mode:** AUDIT ONLY — no LegalDocument mutations. **REQUIRES OWNER/LEGAL DECISION** before changing provider-hosted privacy HTML.",
    "",
    "## Documents audited",
    "",
    report.documentsAudited.length
      ? report.documentsAudited
          .map((d) => `- \`${d.language}\` v${d.version} — ${d.title} (updated ${d.updatedAt})`)
          .join("\n")
      : "_No privacy_policy rows in database._",
    "",
    "## Overclaim findings (conflicts with Slice H / lifecycle behavior)",
    "",
    findings.length
      ? findings
          .map(
            (f) =>
              `### ${f.patternId} (${f.language})\n- **Why:** ${f.why}\n- **Snippet:** …${f.snippet}…\n- **Status:** REQUIRES OWNER/LEGAL APPROVAL to revise`,
          )
          .join("\n\n")
      : "_None detected by hard overclaim patterns._",
    "",
    "## Soft gaps / CareTip-specific clarity (REQUIRES OWNER/LEGAL)",
    "",
    softGaps.length
      ? softGaps
          .map(
            (f) =>
              `### ${f.patternId} (${f.language})\n- **Why:** ${f.why}\n- **Snippet:** …${f.snippet}…\n- **Status:** REQUIRES OWNER/LEGAL APPROVAL — engineering did **not** rewrite hosted HTML`,
          )
          .join("\n\n")
      : "_None detected._",
    "",
    "## Missing recommended themes (informational)",
    "",
    missingThemes.length
      ? missingThemes.map((m) => `- \`${m.language}\` / ${m.themeId}: ${m.note}`).join("\n")
      : "_None (or no documents)._",
    "",
    "## Proposed technical preparation (not applied to LegalDocument)",
    "",
    "1. Keep serving `/api/legal/privacy` from `LegalDocument` unchanged until counsel publishes revised HTML via IT-Recht / approved webhook.",
    "2. Draft themes for counsel (not legal advice; not auto-applied):",
    "   - Distinguish **remove staff from business** vs **delete CareTip account**.",
    "   - State that tip/payment evidence may remain with the venue in limited form after access is revoked.",
    "   - Avoid absolute “all data deleted immediately” language.",
    "   - Do not invent numeric retention years while CareTip `T_*` remain UNSET.",
    "3. Publish EN privacy_policy if product requires EN `/privacy`.",
    "4. Align FAQ/i18n already updated in Slice H with any counsel-approved policy changes.",
    "",
    "## Slice H behavioral truths (engineering)",
    "",
    ...report.sliceHBehavioralTruths.map((t) => `- ${t}`),
    "",
  ].join("\n");
  writeFileSync(outPath, md, "utf8");
  info(`wrote ${outPath}`);

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  // Overclaims in hosted content fail the audit so CI surfaces them; empty DB is not a fail.
  if (failed.length) {
    console.error(`\n${failed.length} discrepancy failure(s) — see ${outPath}`);
    process.exit(1);
  }
  console.log(`\nH-R1 privacy audit completed with ${results.length} notes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
