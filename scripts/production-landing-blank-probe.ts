/**
 * Probe live caretip.de HTML + entry JS for the white-screen contract.
 * Run: npm run test:production-landing-blank-probe
 *
 * This is evidence, not a substitute for a post-deploy browser pass.
 */
const ORIGIN = process.env.CARETIP_ORIGIN ?? "https://caretip.de";

async function get(path: string): Promise<{ status: number; body: string; url: string }> {
  const url = path.startsWith("http") ? path : `${ORIGIN}${path}`;
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    },
  });
  return { status: res.status, body: await res.text(), url };
}

function fail(id: string, detail: string): never {
  console.error(`FAIL  ${id} — ${detail}`);
  process.exit(1);
}

function pass(id: string, detail: string) {
  console.log(`PASS  ${id} — ${detail}`);
}

const html = await get("/");
if (html.status !== 200) fail("html-status", `HTTP ${html.status}`);
pass("html-status", `HTTP 200 ${html.url}`);

const bootDisplay = html.body.match(/#caretip-html-boot\s*\{[^}]*display:\s*([^;]+);/);
if (!bootDisplay || !bootDisplay[1].includes("flex")) {
  fail(
    "boot-display",
    `production still hides the boot by default (${bootDisplay?.[1] ?? "missing"}). Removing caretip-html-boot-active uncovers empty #root.`,
  );
}
pass("boot-display", `#caretip-html-boot display is ${bootDisplay[1].trim()}`);

const bootLocale = await get("/boot-locale.js");
if (bootLocale.status !== 200) fail("boot-locale", `HTTP ${bootLocale.status}`);
if (!bootLocale.body.includes("installPublicLandingBootRetain")) {
  fail("boot-locale-retain", "production boot-locale.js does not retain HTML boot until landing commits");
}
pass("boot-locale-retain", "installPublicLandingBootRetain present");

const entry = html.body.match(/\/assets\/index-[^"']+\.js/);
if (!entry) fail("entry-script", "no /assets/index-*.js in HTML");
const js = await get(entry[0]);
if (js.status !== 200) fail("entry-js", `HTTP ${js.status} ${entry[0]}`);
if (!js.body.includes("shouldRetainHtmlBootUntilLandingCommit") && !js.body.includes("caretip-landing")) {
  fail(
    "entry-landing",
    "entry JS has neither retain helper nor caretip-landing — `/` is still a late lazy chunk",
  );
}
if (js.body.includes("caretip-landing")) {
  pass("eager-landing", "caretip-landing is in the HTML entry graph (not only a lazy LandingPage chunk)");
} else {
  pass("retain-in-entry", "shouldRetain present; confirm LandingPage is still not an empty Outlet");
}

console.log("\nproduction-landing-blank-probe: ok");
