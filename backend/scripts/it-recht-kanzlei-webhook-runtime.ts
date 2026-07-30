/**
 * IT-Recht Kanzlei legal webhook — XML parsing, auth, and action responses.
 * Run: npm run test:it-recht-kanzlei-webhook (backend)
 */
import {
  authenticateItRechtRequest,
  handleItRechtGetAccountList,
  handleItRechtGetVersion,
  mapPushToDocumentInput,
  processItRechtXmlRequest,
} from "../src/services/itRechtKanzlei/itRechtKanzleiWebhook.service.js";
import {
  buildItRechtAuthErrorXml,
  buildItRechtXmlResponse,
} from "../src/services/itRechtKanzlei/itRechtKanzleiXmlBuilder.js";
import { parseItRechtXmlPayload } from "../src/services/itRechtKanzlei/itRechtKanzleiXmlParser.js";
import { LegalDocumentType } from "@prisma/client";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const TEST_TOKEN = "test-it-recht-token-abc123";

function xmlApi(action: string, extra = "", token = TEST_TOKEN): string {
  return `<?xml version="1.0" encoding="UTF-8"?><api><api_version>1.0</api_version><action>${action}</action><user_auth_token>${token}</user_auth_token>${extra}</api>`;
}

function assertIncludes(label: string, haystack: string, needles: string[]): void {
  const missing = needles.filter((n) => !haystack.includes(n));
  if (missing.length) fail(`${label} missing: ${missing.join(", ")}`);
  else pass(label);
}

async function main(): Promise<void> {
  const prevToken = process.env.LEGAL_PROVIDER_TOKEN;
  process.env.LEGAL_PROVIDER_TOKEN = TEST_TOKEN;

  try {
    const getVersionXml = xmlApi("getversion");
    const parsedVersion = parseItRechtXmlPayload(getVersionXml);
    if (parsedVersion.action !== "getversion" || parsedVersion.apiVersion !== "1.0") {
      fail("parse getversion action and api_version");
    } else {
      pass("parse getversion action and api_version");
    }

    if (parsedVersion.userAuthToken !== TEST_TOKEN) {
      fail("parse user_auth_token");
    } else {
      pass("parse user_auth_token");
    }

    const pushXml = xmlApi(
      "push",
      `<user_account_id>0</user_account_id><rechtstext_type>datenschutz</rechtstext_type><rechtstext_title>Privacy Policy</rechtstext_title><rechtstext_country>DE</rechtstext_country><rechtstext_language>de</rechtstext_language><rechtstext_html>%3Cp%3EHello%3C%2Fp%3E</rechtstext_html><rechtstext_pdf_url>https://example.com/doc.pdf</rechtstext_pdf_url><rechtstext_pdf_md5hash>abc123</rechtstext_pdf_md5hash>`,
    );
    const parsedPush = parseItRechtXmlPayload(pushXml);
    const expectedFields: Array<[string, unknown]> = [
      ["rechtstextType", "datenschutz"],
      ["rechtstextTitle", "Privacy Policy"],
      ["rechtstextCountry", "DE"],
      ["rechtstextLanguage", "de"],
      ["rechtstextHtml", "<p>Hello</p>"],
      ["rechtstextPdfUrl", "https://example.com/doc.pdf"],
      ["userAccountId", "0"],
    ];
    for (const [field, expected] of expectedFields) {
      const actual = parsedPush[field as keyof typeof parsedPush];
      if (actual !== expected) fail(`parse push field ${field} expected ${String(expected)} got ${String(actual)}`);
      else pass(`parse push field ${field}`);
    }

    if (authenticateItRechtRequest({ userAuthToken: TEST_TOKEN })) pass("token authentication accepts valid token");
    else fail("token authentication accepts valid token");

    if (!authenticateItRechtRequest({ userAuthToken: "wrong-token" })) pass("token authentication rejects invalid token");
    else fail("token authentication rejects invalid token");

    const getVersionResponse = buildItRechtXmlResponse(handleItRechtGetVersion());
    assertIncludes("getversion success XML", getVersionResponse, [
      "<status>success</status>",
      "<meta_shopversion>",
      "<meta_modulversion>",
    ]);

    const accountListResponse = buildItRechtXmlResponse(handleItRechtGetAccountList());
    assertIncludes("getaccountlist success XML", accountListResponse, [
      "<status>success</status>",
      "<account>",
      "<accountid>0</accountid>",
      "<locale>de</locale>",
      "<country>DE</country>",
    ]);

    const authErrorXml = buildItRechtAuthErrorXml();
    assertIncludes("auth error XML", authErrorXml, [
      "<status>error</status>",
      "<error>3</error>",
      "<error_message>Invalid authentication token.</error_message>",
    ]);

    const invalidTokenResult = await processItRechtXmlRequest(xmlApi("getversion", "", "bad-token"));
    if (invalidTokenResult.status === "error" && invalidTokenResult.error === 3) {
      pass("processItRechtXmlRequest rejects invalid token with error 3");
    } else {
      fail("processItRechtXmlRequest rejects invalid token with error 3");
    }

    const validGetVersion = await processItRechtXmlRequest(getVersionXml);
    if (validGetVersion.status === "success") pass("processItRechtXmlRequest getversion succeeds");
    else fail("processItRechtXmlRequest getversion succeeds");

    const validAccountList = await processItRechtXmlRequest(xmlApi("getaccountlist"));
    if (validAccountList.status === "success" && (validAccountList.accounts?.length ?? 0) > 0) {
      pass("processItRechtXmlRequest getaccountlist succeeds");
    } else {
      fail("processItRechtXmlRequest getaccountlist succeeds");
    }

    const pushInput = mapPushToDocumentInput(parsedPush);
    if (
      pushInput.type === LegalDocumentType.privacy_policy &&
      pushInput.language === "de" &&
      pushInput.title === "Privacy Policy" &&
      pushInput.contentHtml === "<p>Hello</p>" &&
      pushInput.version === "abc123"
    ) {
      pass("mapPushToDocumentInput maps datenschutz push payload");
    } else {
      fail("mapPushToDocumentInput maps datenschutz push payload");
    }

    try {
      mapPushToDocumentInput({
        rechtstextType: "widerruf",
        rechtstextTitle: "W",
        rechtstextCountry: "DE",
        rechtstextLanguage: "de",
        rechtstextHtml: "<p>x</p>",
        rechtstextPdfUrl: "https://example.com/x.pdf",
      });
      fail("mapPushToDocumentInput rejects unsupported rechtstext_type");
    } catch (err) {
      const code =
        typeof err === "object" && err !== null && "itRechtErrorCode" in err
          ? (err as { itRechtErrorCode: unknown }).itRechtErrorCode
          : null;
      if (code === 4) pass("mapPushToDocumentInput rejects unsupported rechtstext_type");
      else fail("mapPushToDocumentInput rejects unsupported rechtstext_type");
    }
  } finally {
    if (prevToken === undefined) delete process.env.LEGAL_PROVIDER_TOKEN;
    else process.env.LEGAL_PROVIDER_TOKEN = prevToken;
  }

  const failures = results.filter((line) => line.startsWith("FAIL:"));
  for (const line of results) console.log(line);
  console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
