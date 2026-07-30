/**
 * IT-Recht Kanzlei legal webhook — LTI XML Specification compliance tests.
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
import { parseItRechtXmlPayload, resolveItRechtAction } from "../src/services/itRechtKanzlei/itRechtKanzleiXmlParser.js";
import {
  buildItRechtTokenAuthDiagnostics,
  tokensMatchItRechtAuth,
} from "../src/services/itRechtKanzlei/itRechtKanzleiTokenAuth.js";
import { decodeItRechtHtml } from "../src/services/itRechtKanzlei/itRechtKanzleiHtmlDecoder.js";
import { isValidRechtstextPdfBase64 } from "../src/services/itRechtKanzlei/itRechtKanzleiPdfValidator.js";
import { LegalDocumentType } from "@prisma/client";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const TEST_TOKEN = "test-it-recht-token-abc123";
const VALID_PDF_B64 = "JVBERi0xLjA=";

function xmlApi(action: string, extra = "", token = TEST_TOKEN): string {
  return `<?xml version="1.0" encoding="UTF-8"?><api><api_version>1.0</api_version><action>${action}</action><user_auth_token>${token}</user_auth_token>${extra}</api>`;
}

function pushExtras(overrides = ""): string {
  return `<user_account_id>0</user_account_id><rechtstext_type>datenschutz</rechtstext_type><rechtstext_type_ucase>DATENSCHUTZ</rechtstext_type_ucase><rechtstext_title>Privacy Policy</rechtstext_title><rechtstext_country>DE</rechtstext_country><rechtstext_language>de</rechtstext_language><rechtstext_language_iso639_2b>ger</rechtstext_language_iso639_2b><rechtstext_pdf_filenamebase_suggestion>datenschutz</rechtstext_pdf_filenamebase_suggestion><rechtstext_pdf_filename_suggestion>datenschutz.pdf</rechtstext_pdf_filename_suggestion><rechtstext_pdf_localized_filenamebase_suggestion>privacy-policy</rechtstext_pdf_localized_filenamebase_suggestion><rechtstext_text>Plain text body</rechtstext_text><rechtstext_html>%3Cp%3EHello%3C%2Fp%3E</rechtstext_html><rechtstext_pdf>${VALID_PDF_B64}</rechtstext_pdf><rechtstext_pdf_md5hash>abc123</rechtstext_pdf_md5hash>${overrides}`;
}

function assertIncludes(label: string, haystack: string, needles: string[]): void {
  const missing = needles.filter((n) => !haystack.includes(n));
  if (missing.length) fail(`${label} missing: ${missing.join(", ")}`);
  else pass(label);
}

function expectErrorCode(label: string, fn: () => void, code: number): void {
  try {
    fn();
    fail(`${label} should throw error ${code}`);
  } catch (err) {
    const actual =
      typeof err === "object" && err !== null && "itRechtErrorCode" in err
        ? (err as { itRechtErrorCode: unknown }).itRechtErrorCode
        : null;
    if (actual === code) pass(label);
    else fail(`${label} expected error ${code}, got ${String(actual)}`);
  }
}

async function expectProcessError(label: string, xml: string, code: number): Promise<void> {
  const result = await processItRechtXmlRequest(xml);
  if (result.status === "error" && result.error === code) pass(label);
  else fail(`${label} expected error ${code}, got ${JSON.stringify(result)}`);
}

async function main(): Promise<void> {
  const prevToken = process.env.LEGAL_PROVIDER_TOKEN;
  const prevMultishop = process.env.LEGAL_IT_RECHT_MULTISHOP;
  const prevLocales = process.env.LEGAL_IT_RECHT_ACCOUNT_LOCALES;
  const prevCountries = process.env.LEGAL_IT_RECHT_ACCOUNT_COUNTRIES;
  process.env.LEGAL_PROVIDER_TOKEN = TEST_TOKEN;
  delete process.env.LEGAL_IT_RECHT_MULTISHOP;
  delete process.env.LEGAL_IT_RECHT_ACCOUNT_LOCALES;
  delete process.env.LEGAL_IT_RECHT_ACCOUNT_COUNTRIES;

  try {
    const getVersionXml = xmlApi("getversion");
    const parsedVersion = parseItRechtXmlPayload(getVersionXml);
    if (parsedVersion.action === "getversion" && parsedVersion.apiVersion === "1.0") {
      pass("parse getversion action and api_version");
    } else fail("parse getversion action and api_version");

    if (parsedVersion.userAuthToken === TEST_TOKEN) pass("parse user_auth_token");
    else fail("parse user_auth_token");

    if (resolveItRechtAction({ action: "version" }) === "getversion") pass("action alias version -> getversion");
    else fail("action alias version -> getversion");

    const pushXml = xmlApi("push", pushExtras());
    const parsedPush = parseItRechtXmlPayload(pushXml);
    const expectedFields: Array<[string, unknown]> = [
      ["rechtstextType", "datenschutz"],
      ["rechtstextTypeUcase", "DATENSCHUTZ"],
      ["rechtstextTitle", "Privacy Policy"],
      ["rechtstextCountry", "DE"],
      ["rechtstextLanguage", "de"],
      ["rechtstextLanguageIso6392b", "ger"],
      ["rechtstextHtml", "<p>Hello</p>"],
      ["rechtstextText", "Plain text body"],
      ["rechtstextPdfFilenamebaseSuggestion", "datenschutz"],
      ["rechtstextPdfFilenameSuggestion", "datenschutz.pdf"],
      ["rechtstextPdfLocalizedFilenamebaseSuggestion", "privacy-policy"],
      ["userAccountId", "0"],
    ];
    for (const [field, expected] of expectedFields) {
      const actual = parsedPush[field as keyof typeof parsedPush];
      if (actual !== expected) fail(`parse push field ${field}`);
      else pass(`parse push field ${field}`);
    }

    if (decodeItRechtHtml("%3Ch1%3EHi%3C%2Fh1%3E") === "<h1>Hi</h1>") pass("decodeItRechtHtml URL-decodes");
    else fail("decodeItRechtHtml URL-decodes");

    if (isValidRechtstextPdfBase64(VALID_PDF_B64)) pass("valid PDF base64 accepted");
    else fail("valid PDF base64 accepted");
    if (!isValidRechtstextPdfBase64("WRONG_PDF")) pass("invalid PDF base64 rejected");
    else fail("invalid PDF base64 rejected");

    if (authenticateItRechtRequest({ userAuthToken: TEST_TOKEN })) pass("token auth accepts valid token");
    else fail("token auth accepts valid token");
    if (!authenticateItRechtRequest({ userAuthToken: "wrong" })) pass("token auth rejects invalid token");
    else fail("token auth rejects invalid token");

    process.env.LEGAL_PROVIDER_TOKEN = `  ${TEST_TOKEN}  `;
    if (tokensMatchItRechtAuth(TEST_TOKEN)) pass("token auth compares trimmed values");
    else fail("token auth compares trimmed values");
    const whitespaceDiag = buildItRechtTokenAuthDiagnostics(` ${TEST_TOKEN} `);
    if (whitespaceDiag.equalAfterTrim && !whitespaceDiag.receivedTrimmed) {
      pass("token diagnostics report trim normalization");
    } else {
      fail("token diagnostics report trim normalization");
    }
    process.env.LEGAL_PROVIDER_TOKEN = TEST_TOKEN;

    delete process.env.LEGAL_PROVIDER_TOKEN;
    const missingDiag = buildItRechtTokenAuthDiagnostics(TEST_TOKEN);
    if (missingDiag.expectedMissing && !missingDiag.expectedConfigured) {
      pass("token diagnostics report missing LEGAL_PROVIDER_TOKEN");
    } else {
      fail("token diagnostics report missing LEGAL_PROVIDER_TOKEN");
    }
    process.env.LEGAL_PROVIDER_TOKEN = TEST_TOKEN;

    process.env.LEGAL_PROVIDER_USERNAME = "itrk-user";
    process.env.LEGAL_PROVIDER_PASSWORD = "itrk-pass";
    if (authenticateItRechtRequest({ userUsername: "itrk-user", userPassword: "itrk-pass" })) {
      pass("username/password auth accepts valid credentials");
    } else fail("username/password auth accepts valid credentials");
    delete process.env.LEGAL_PROVIDER_USERNAME;
    delete process.env.LEGAL_PROVIDER_PASSWORD;

    const getVersionResponse = buildItRechtXmlResponse(handleItRechtGetVersion());
    assertIncludes("getversion XML declaration", getVersionResponse, [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      "<status>success</status>",
      "<meta_shopversion>",
      "<meta_modulversion>",
    ]);

    const accountListResponse = buildItRechtXmlResponse(handleItRechtGetAccountList());
    assertIncludes("getaccountlist XML", accountListResponse, [
      "<status>success</status>",
      "<accountid>0</accountid>",
      "<accountname/>",
    ]);

    const authErrorXml = buildItRechtAuthErrorXml();
    assertIncludes("auth error XML", authErrorXml, [
      "<status>error</status>",
      "<error>3</error>",
      "<error_message>Invalid authentication token.</error_message>",
    ]);

    await expectProcessError("invalid token -> error 3", xmlApi("getversion", "", "bad"), 3);
    await expectProcessError("invalid action -> error 10", xmlApi("not-an-action"), 10);

    const validGetVersion = await processItRechtXmlRequest(getVersionXml);
    if (validGetVersion.status === "success") pass("processItRechtXmlRequest getversion succeeds");
    else fail("processItRechtXmlRequest getversion succeeds");

    const validAccountList = await processItRechtXmlRequest(xmlApi("getaccountlist"));
    if (validAccountList.status === "success") pass("processItRechtXmlRequest getaccountlist succeeds");
    else fail("processItRechtXmlRequest getaccountlist succeeds");

    const pushInput = mapPushToDocumentInput(parsedPush);
    if (
      pushInput.type === LegalDocumentType.privacy_policy &&
      pushInput.language === "de" &&
      pushInput.contentHtml === "<p>Hello</p>" &&
      pushInput.version === "abc123"
    ) {
      pass("mapPushToDocumentInput maps datenschutz push payload");
    } else {
      fail("mapPushToDocumentInput maps datenschutz push payload");
    }

    expectErrorCode("missing rechtstext_text -> error 5", () => {
      mapPushToDocumentInput({
        ...parsedPush,
        rechtstextText: undefined,
      });
    }, 5);

    expectErrorCode("missing rechtstext_html -> error 6", () => {
      mapPushToDocumentInput({
        ...parsedPush,
        rechtstextHtml: undefined,
      });
    }, 6);

    expectErrorCode("invalid rechtstext_pdf -> error 7", () => {
      mapPushToDocumentInput({
        ...parsedPush,
        rechtstextPdf: "WRONG_PDF",
      });
    }, 7);

    expectErrorCode("missing iso639_2b -> error 9", () => {
      mapPushToDocumentInput({
        ...parsedPush,
        rechtstextLanguageIso6392b: undefined,
      });
    }, 9);

    expectErrorCode("unsupported rechtstext_type -> error 4", () => {
      mapPushToDocumentInput({
        ...parsedPush,
        rechtstextType: "widerruf",
      });
    }, 4);

    try {
      mapPushToDocumentInput({
        rechtstextType: "impressum",
        rechtstextTitle: "Impressum",
        rechtstextCountry: "DE",
        rechtstextLanguage: "de",
        rechtstextLanguageIso6392b: "ger",
        rechtstextText: "Text",
        rechtstextHtml: "<h1>Impressum</h1>",
      });
      pass("impressum push skips PDF requirement");
    } catch {
      fail("impressum push skips PDF requirement");
    }

    process.env.LEGAL_IT_RECHT_MULTISHOP = "true";
    expectErrorCode("multishop missing user_account_id -> error 11", () => {
      mapPushToDocumentInput({
        ...parsedPush,
        userAccountId: undefined,
      });
    }, 11);
    delete process.env.LEGAL_IT_RECHT_MULTISHOP;

    process.env.LEGAL_IT_RECHT_ACCOUNT_LOCALES = "de,en";
    process.env.LEGAL_IT_RECHT_ACCOUNT_COUNTRIES = "DE";
    expectErrorCode("unsupported language -> error 82", () => {
      mapPushToDocumentInput({
        ...parsedPush,
        rechtstextLanguage: "fr",
        rechtstextLanguageIso6392b: "fre",
      });
    }, 82);
    expectErrorCode("unsupported country -> error 17", () => {
      mapPushToDocumentInput({
        ...parsedPush,
        rechtstextCountry: "US",
      });
    }, 17);
    delete process.env.LEGAL_IT_RECHT_ACCOUNT_LOCALES;
    delete process.env.LEGAL_IT_RECHT_ACCOUNT_COUNTRIES;

    try {
      parseItRechtXmlPayload("");
      fail("empty XML -> error 12");
    } catch (err) {
      const code =
        typeof err === "object" && err !== null && "itRechtErrorCode" in err
          ? (err as { itRechtErrorCode: unknown }).itRechtErrorCode
          : null;
      if (code === 12) pass("empty XML -> error 12");
      else fail("empty XML -> error 12");
    }

    try {
      parseItRechtXmlPayload("not xml");
      fail("malformed XML -> error 12");
    } catch (err) {
      const code =
        typeof err === "object" && err !== null && "itRechtErrorCode" in err
          ? (err as { itRechtErrorCode: unknown }).itRechtErrorCode
          : null;
      if (code === 12) pass("malformed XML -> error 12");
      else fail("malformed XML -> error 12");
    }
  } finally {
    if (prevToken === undefined) delete process.env.LEGAL_PROVIDER_TOKEN;
    else process.env.LEGAL_PROVIDER_TOKEN = prevToken;
    if (prevMultishop === undefined) delete process.env.LEGAL_IT_RECHT_MULTISHOP;
    else process.env.LEGAL_IT_RECHT_MULTISHOP = prevMultishop;
    if (prevLocales === undefined) delete process.env.LEGAL_IT_RECHT_ACCOUNT_LOCALES;
    else process.env.LEGAL_IT_RECHT_ACCOUNT_LOCALES = prevLocales;
    if (prevCountries === undefined) delete process.env.LEGAL_IT_RECHT_ACCOUNT_COUNTRIES;
    else process.env.LEGAL_IT_RECHT_ACCOUNT_COUNTRIES = prevCountries;
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
