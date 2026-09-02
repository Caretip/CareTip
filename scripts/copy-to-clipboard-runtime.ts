/**
 * Copy-to-clipboard success/failure and independent control keys.
 * Run: npm run test:copy-to-clipboard
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nextCopiedKey, writeTextToClipboard } from "../src/app/lib/copyToClipboard";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

if (nextCopiedKey(null, "a", true) === "a") {
  pass("Successful copy sets that control's key");
} else {
  fail("nextCopiedKey success");
}

if (nextCopiedKey("a", "b", true) === "b") {
  pass("Copying a second control does not leave every button in the Copied state");
} else {
  fail("nextCopiedKey independent keys");
}

if (nextCopiedKey(null, "a", false) === null && nextCopiedKey("a", "a", false) === null) {
  pass("Failed copy never displays Copied for that control");
} else {
  fail("nextCopiedKey failure must not show Copied");
}

if (nextCopiedKey("b", "a", false) === "b") {
  pass("Failed copy of one control does not clear another control's Copied state");
} else {
  fail("nextCopiedKey failure isolation");
}

if (nextCopiedKey("a", "a", true) === "a") {
  pass("Rapid re-copy of the same control keeps that key (timeout owner resets separately)");
} else {
  fail("nextCopiedKey rapid same-key success");
}

async function withMockClipboard(
  writeText: ((value: string) => Promise<void>) | undefined,
  run: () => Promise<void>,
) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: writeText
      ? { clipboard: { writeText } }
      : { clipboard: undefined },
  });
  try {
    await run();
  } finally {
    if (prev) Object.defineProperty(globalThis, "navigator", prev);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
}

await withMockClipboard(async (value) => {
  if (value !== "invite-code") throw new Error("unexpected payload");
}, async () => {
  const ok = await writeTextToClipboard("invite-code");
  if (ok) pass("writeTextToClipboard succeeds via clipboard.writeText");
  else fail("writeTextToClipboard should succeed when clipboard.writeText resolves");
});

await withMockClipboard(async () => {
  throw new Error("denied");
}, async () => {
  const ok = await writeTextToClipboard("secret");
  if (!ok) pass("writeTextToClipboard returns false when clipboard.writeText rejects (no document fallback in Node)");
  else fail("failed clipboard write must not report success");
});

const pages = [
  "src/app/pages/business/StaffManagementPage.tsx",
  "src/app/pages/business/TablesPage.tsx",
  "src/app/pages/business/QRCodeManagementPage.tsx",
  "src/app/components/employee/EmployeeQRCodeModal.tsx",
];

for (const rel of pages) {
  const src = read(rel);
  if (src.includes("navigator.clipboard.writeText")) {
    fail(`${rel} still calls navigator.clipboard.writeText directly`);
  } else if (src.includes("useCopyFeedback")) {
    pass(`${rel} uses shared useCopyFeedback`);
  } else {
    fail(`${rel} missing useCopyFeedback`);
  }
}

if (
  read("src/app/pages/business/StaffManagementPage.tsx").includes('t("common.copied")') &&
  read("src/app/pages/business/TablesPage.tsx").includes('t("common.copied")') &&
  read("src/app/components/employee/EmployeeQRCodeModal.tsx").includes('t("common.copied")') &&
  read("src/app/components/business/QrManagementCard.tsx").includes('t("common.copied")')
) {
  pass("Copy controls show a Copied label via common.copied");
} else {
  fail("Copied label missing from one or more copy controls");
}

const hook = read("src/app/hooks/useCopyFeedback.ts");
if (
  hook.includes("clearTimeout") &&
  hook.includes("useEffect") &&
  hook.includes("return () =>")
) {
  pass("useCopyFeedback clears the Copied timeout on unmount");
} else {
  fail("useCopyFeedback must clean up timeout on unmount");
}

const qrCard = read("src/app/components/business/QrManagementCard.tsx");
if (qrCard.includes("copiedId === item.id") && qrCard.includes('t("common.copied")')) {
  pass("QR cards show Copied only for the matching item id");
} else {
  fail("QrManagementCard copied-state wiring drifted");
}

const failed = results.filter((r) => r.startsWith("FAIL:"));
for (const line of results) console.log(line);
if (failed.length) {
  console.error(`\n${failed.length} copy-to-clipboard check(s) failed`);
  process.exit(1);
}
console.log("\nAll copy-to-clipboard checks passed");
