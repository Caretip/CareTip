/**
 * Customer QR loading language / overlay ownership regressions (no browser).
 *
 *   npm run test:customer-loading-language
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { shouldMountReactBootOverlay } from "../src/app/lib/htmlMarketingBootBridge.ts";
import { resolveCustomerJourneyBootContext } from "../src/app/lib/appLoadingContexts.ts";
import { resolveAppLanguageFromCode } from "../src/i18n/i18n.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const en = JSON.parse(read("src/i18n/locales/en.json")) as {
  common: { loading: { tipPage: string } };
};
const de = JSON.parse(read("src/i18n/locales/de.json")) as {
  common: { loading: { tipPage: string } };
};
const EN_TIP = en.common.loading.tipPage;
const DE_TIP = de.common.loading.tipPage;

function bothTipLanguagesVisible(texts: string[]): boolean {
  const joined = texts.join("\n");
  const hasEn = joined.includes("Opening your tip page");
  const hasDe = joined.includes("Trinkgeldseite wird geöffnet");
  return hasEn && hasDe;
}

function loadBootLocale() {
  const code = read("public/boot-locale.js");
  const tagline = { textContent: "" };
  const boot = {
    setAttribute() {},
    removeAttribute() {},
  };
  const sandbox: Record<string, unknown> = {
    localStorage: {
      getItem: () => null,
    },
    location: { pathname: "/qr-landing/demo" },
    document: {
      documentElement: {
        setAttribute() {},
        classList: { add() {} },
      },
      getElementById: (id: string) => {
        if (id === "caretip-html-boot-tagline") return tagline;
        if (id === "caretip-html-boot") return boot;
        return null;
      },
      readyState: "complete",
      addEventListener() {},
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox.CareTipBootLocale as {
    getCopy: (lng: string) => { tipPage: string; gettingReady: string };
    resolveBootTagline: (copy: { tipPage: string; gettingReady: string }, pathname: string) => string;
    isGuestSlugPath: (path: string) => boolean;
  };
}

function run() {
  assert.equal(EN_TIP, "Opening your tip page…");
  assert.equal(DE_TIP, "Ihre Trinkgeldseite wird geöffnet…");
  assert.notEqual(EN_TIP, DE_TIP);

  assert.equal(bothTipLanguagesVisible([EN_TIP]), false);
  assert.equal(bothTipLanguagesVisible([DE_TIP]), false);
  assert.equal(bothTipLanguagesVisible([EN_TIP, DE_TIP]), true);

  assert.equal(shouldMountReactBootOverlay(true, true), false);
  assert.equal(shouldMountReactBootOverlay(true, false), true);
  assert.equal(shouldMountReactBootOverlay(false, true), false);
  assert.equal(shouldMountReactBootOverlay(false, false), false);

  const indexHtml = read("index.html");
  assert.match(
    indexHtml,
    /#caretip-html-boot \{\s*display:\s*flex;/s,
    "HTML boot stays painted even if html.caretip-html-boot-active is stripped during React start",
  );
  assert.match(indexHtml, /html\.caretip-html-boot-active #caretip-html-boot/);
  assert.match(indexHtml, /<script src="\/boot-locale\.js"><\/script>/);
  const bootIdx = indexHtml.indexOf('id="caretip-html-boot"');
  const scriptIdx = indexHtml.indexOf('<script src="/boot-locale.js">');
  const rootIdx = indexHtml.indexOf('id="root"');
  assert.ok(bootIdx > 0 && scriptIdx > bootIdx && scriptIdx < rootIdx, "boot-locale.js must run after boot markup, before #root");

  const i18nSrc = read("src/i18n/i18n.ts");
  assert.doesNotMatch(i18nSrc, /fallbackLng:\s*"en"/);
  assert.match(i18nSrc, /fallbackLng:\s*lng/);
  assert.match(i18nSrc, /load:\s*"currentOnly"/);
  assert.doesNotMatch(i18nSrc, /scheduleFallbackLocaleLoad/);

  const managerSrc = read("src/app/context/AppLoadingManager.tsx");
  assert.match(managerSrc, /shouldMountReactBootOverlay\(overlayPresented\)/);
  assert.match(managerSrc, /readDocumentOrStoredLanguage/);

  const loaderSrc = read("src/app/components/CareTipPageLoader.tsx");
  assert.match(loaderSrc, /holdUnderHtmlBoot/);
  assert.match(loaderSrc, /isHtmlBootElementPresent/);

  assert.equal(resolveAppLanguageFromCode("de"), "de");
  assert.equal(resolveAppLanguageFromCode("de-DE"), "de");
  assert.equal(resolveAppLanguageFromCode("en"), "en");
  assert.equal(resolveAppLanguageFromCode("en-GB"), "en");
  assert.equal(resolveAppLanguageFromCode(undefined), "de");
  assert.equal(resolveAppLanguageFromCode("fr"), "de");

  const boot = loadBootLocale();
  const deCopy = boot.getCopy("de");
  const enCopy = boot.getCopy("en");
  assert.equal(deCopy.tipPage, DE_TIP);
  assert.equal(enCopy.tipPage, EN_TIP);

  const guestPaths = [
    "/qr-landing/biz1",
    "/qr/employee/emp1",
    "/qr/location/loc1",
    "/qr/table/tbl1",
    "/staff/alex",
    "/table/slug-1",
    "/tip-amount",
    "/select-employee",
    "/cafe-am-markt",
    "/cafe-am-markt/alex",
  ];
  for (const p of guestPaths) {
    assert.equal(boot.resolveBootTagline(deCopy, p), DE_TIP, `boot DE tip copy for ${p}`);
    assert.equal(boot.resolveBootTagline(enCopy, p), EN_TIP, `boot EN tip copy for ${p}`);
    assert.equal(resolveCustomerJourneyBootContext(p), "tipPage", `react boot context for ${p}`);
  }

  assert.equal(boot.resolveBootTagline(deCopy, "/pricing"), deCopy.gettingReady);
  assert.equal(resolveCustomerJourneyBootContext("/pricing"), null);
  assert.equal(boot.isGuestSlugPath("/pricing"), false);
  assert.equal(boot.isGuestSlugPath("/cafe-am-markt"), true);

  const switcher = read("src/components/i18n/LanguageSwitcher.tsx");
  assert.match(switcher, /resolveAppLanguageFromCode/);
  assert.doesNotMatch(switcher, /resolvedLanguage\?\.toLowerCase\(\)\.startsWith\("de"\) \? "de" : "en"/);

  console.log("customer-loading-language-runtime: OK");
}

run();
