/**
 * Legal-document loader message regressions (no browser).
 *
 *   npm run test:legal-document-loading
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  resolveCustomerJourneyBootContext,
  resolveLegalDocumentLoadingKind,
  resolveRouteLoadingMessage,
} from "../src/app/lib/appLoadingContexts.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const en = JSON.parse(read("src/i18n/locales/en.json")) as {
  common: { loading: { tipPage: string; legal: Record<string, string> } };
};
const de = JSON.parse(read("src/i18n/locales/de.json")) as {
  common: { loading: { tipPage: string; legal: Record<string, string> } };
};

function loadBootLocale() {
  const code = read("public/boot-locale.js");
  const sandbox: Record<string, unknown> = {
    localStorage: { getItem: () => null },
    location: { pathname: "/privacy" },
    document: {
      documentElement: { setAttribute() {}, classList: { add() {} } },
      getElementById: () => null,
      readyState: "complete",
      addEventListener() {},
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox.CareTipBootLocale as {
    getCopy: (lng: string) => Record<string, string>;
    resolveBootTagline: (copy: Record<string, string>, pathname: string) => string;
  };
}

const tEn = ((key: string) => {
  const parts = key.split(".");
  let cur: unknown = en;
  for (const part of parts) {
    cur = (cur as Record<string, unknown>)[part];
  }
  return String(cur);
}) as (key: string) => string;

const tDe = ((key: string) => {
  const parts = key.split(".");
  let cur: unknown = de;
  for (const part of parts) {
    cur = (cur as Record<string, unknown>)[part];
  }
  return String(cur);
}) as (key: string) => string;

function run() {
  const legalPaths: Array<{ path: string; kind: string }> = [
    { path: "/privacy", kind: "privacy" },
    { path: "/terms", kind: "terms" },
    { path: "/cookies", kind: "cookies" },
    { path: "/imprint", kind: "imprint" },
    { path: "/avv", kind: "dpa" },
    { path: "/dpa", kind: "dpa" },
    { path: "/plv", kind: "plv" },
  ];

  for (const { path: p, kind } of legalPaths) {
    assert.equal(resolveLegalDocumentLoadingKind(p), kind, `kind for ${p}`);
    const enMsg = resolveRouteLoadingMessage(p, tEn);
    const deMsg = resolveRouteLoadingMessage(p, tDe);
    assert.equal(enMsg, en.common.loading.legal[kind], `EN route message for ${p}`);
    assert.equal(deMsg, de.common.loading.legal[kind], `DE route message for ${p}`);
    assert.notEqual(enMsg, en.common.loading.tipPage, `legal EN must not use tipPage for ${p}`);
    assert.notEqual(deMsg, de.common.loading.tipPage, `legal DE must not use tipPage for ${p}`);
  }

  assert.equal(resolveCustomerJourneyBootContext("/qr-landing/demo"), "tipPage");
  assert.equal(resolveLegalDocumentLoadingKind("/qr-landing/demo"), null);

  const boot = loadBootLocale();
  const enCopy = boot.getCopy("en");
  const deCopy = boot.getCopy("de");
  for (const { path: p, kind } of legalPaths) {
    assert.equal(boot.resolveBootTagline(enCopy, p), en.common.loading.legal[kind], `boot EN ${p}`);
    assert.equal(boot.resolveBootTagline(deCopy, p), de.common.loading.legal[kind], `boot DE ${p}`);
  }

  assert.equal(boot.resolveBootTagline(enCopy, "/qr-landing/demo"), en.common.loading.tipPage);
  assert.equal(boot.resolveBootTagline(enCopy, "/pricing"), enCopy.gettingReady);

  const registrarSrc = read("src/app/components/RouteNavigationLoadingRegistrar.tsx");
  assert.match(registrarSrc, /resolveLegalDocumentLoadingMessage/);
  assert.match(registrarSrc, /setHtmlBootBridgeTagline/);

  const chunkHoldSrc = read("src/app/routing/PublicRouteChunkHold.tsx");
  assert.match(chunkHoldSrc, /resolveLegalDocumentLoadingMessage/);

  console.log("legal-document-loading-runtime: OK");
}

run();
