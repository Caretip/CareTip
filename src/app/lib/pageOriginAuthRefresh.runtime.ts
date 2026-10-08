import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBrowserAuthRefreshUrl } from "./pageOriginAuthRefresh";

const pageOrigin = resolveBrowserAuthRefreshUrl("https://caretip.onrender.com", true);
assert.equal(pageOrigin, "/api/auth/refresh");
assert.equal(pageOrigin.includes("onrender.com"), false);

const apiOrigin = resolveBrowserAuthRefreshUrl("https://caretip.onrender.com", false);
assert.equal(apiOrigin, "https://caretip.onrender.com/api/auth/refresh");

const relative = resolveBrowserAuthRefreshUrl("", false);
assert.equal(relative, "/api/auth/refresh");

const pagePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../pages/FacebookOAuthCompletePage.tsx",
);
const pageSource = readFileSync(pagePath, "utf8");
assert.ok(pageSource.includes("preferPageOriginAuthRefresh()"));
assert.equal(pageSource.includes("caretip.onrender.com"), false);
assert.ok(pageSource.includes("refreshSessionAPI()"));

console.log("pageOriginAuthRefresh-runtime: all passed");
