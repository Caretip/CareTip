/**
 * OAuth manager welcome email regression (static + content checks).
 * Run: npm run test:oauth-welcome-email (backend)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildWelcomeEmailContent } from "../src/emails/i18nEmail.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function includesAll(haystack: string, needles: string[], label: string): void {
  const missing = needles.filter((n) => !haystack.includes(n));
  if (missing.length) {
    fail(`${label} missing: ${missing.join(", ")}`);
  } else {
    pass(`${label} includes required copy`);
  }
}

function main() {
  const oauthSrc = readFileSync(join(process.cwd(), "src/services/oauthAuth.service.ts"), "utf8");
  const emailSrc = readFileSync(join(process.cwd(), "src/services/emailVerification.service.ts"), "utf8");
  const authSvc = readFileSync(join(process.cwd(), "src/services/auth.service.ts"), "utf8");
  const authCtrl = readFileSync(join(process.cwd(), "src/controllers/auth.controller.ts"), "utf8");

  if (!authSvc.includes("sendVerificationEmailBestEffort") || !authSvc.includes("export async function registerBusiness")) {
    fail("auth.service registerBusiness / verification wiring expected");
  } else {
    pass("password registerBusiness still sends verification email in auth.service");
  }

  if (!authCtrl.includes("authService.registerBusiness")) {
    fail("auth.controller must still call authService.registerBusiness");
  } else {
    pass("auth.controller register route unchanged");
  }

  if (!oauthSrc.includes("scheduleWelcomeEmailBestEffort")) {
    fail("oauthAuth.service must call scheduleWelcomeEmailBestEffort");
  } else {
    pass("oauthAuth.service imports scheduleWelcomeEmailBestEffort");
  }

  if (!oauthSrc.includes('logContext: "oauth_manager_signup"')) {
    fail("oauth welcome must use oauth_manager_signup log context");
  } else {
    pass("oauth_manager_signup log context present");
  }

  const managerBlock = oauthSrc.slice(
    oauthSrc.indexOf('if (intendedRole === "MANAGER")'),
    oauthSrc.indexOf('if (intendedRole === "EMPLOYEE")'),
  );
  if (!managerBlock.includes("scheduleWelcomeEmailBestEffort")) {
    fail("welcome email must be scheduled in MANAGER signup branch only");
  } else {
    pass("welcome scheduled after MANAGER user+business create");
  }

  if (managerBlock.includes("sendVerificationEmail") || managerBlock.includes("sendEmailVerificationEmail")) {
    fail("OAuth MANAGER signup must not send verification email");
  } else {
    pass("OAuth MANAGER signup does not send verification email");
  }

  const loginBlock = oauthSrc.slice(oauthSrc.indexOf("if (isLogin)"), oauthSrc.indexOf("/** Sign up */"));
  if (loginBlock.includes("scheduleWelcomeEmailBestEffort") || loginBlock.includes("sendWelcomeEmail")) {
    fail("OAuth login must not send welcome email");
  } else {
    pass("OAuth login path does not send welcome email");
  }

  if (!emailSrc.includes("export function scheduleWelcomeEmailBestEffort")) {
    fail("scheduleWelcomeEmailBestEffort must be exported from emailVerification.service");
  } else {
    pass("scheduleWelcomeEmailBestEffort helper exported");
  }

  if (!emailSrc.includes('logContext: "email_verify"')) {
    fail("password verify path must still schedule welcome via email_verify context");
  } else {
    pass("password verify welcome path unchanged (email_verify context)");
  }

  const welcomeCalls = (oauthSrc.match(/scheduleWelcomeEmailBestEffort\(\{/g) ?? []).length;
  if (welcomeCalls !== 1) {
    fail(`oauthAuth must call scheduleWelcomeEmailBestEffort exactly once (found ${welcomeCalls})`);
  } else {
    pass("single welcome schedule call in oauthAuth.service");
  }

  const dashboardUrl = "https://app.caretip.example/dashboard";
  const en = buildWelcomeEmailContent({
    locale: "en",
    dashboardUrl,
    businessName: "Harbor Bistro",
    accountKind: "manager",
  });
  includesAll(
    `${en.subject} ${en.html} ${en.text}`,
    [
      "Welcome to CareTip",
      "Harbor Bistro",
      "Go to dashboard",
      "Complete your business profile",
      "Generate QR codes",
      "Invite your staff",
      "Start receiving tips",
    ],
    "EN manager welcome",
  );
  if (
    en.html.includes("cid:caretip-logo") ||
    en.html.includes("caretip-app-icon.png")
  ) {
    pass("EN welcome includes CareTip brand icon");
  } else {
    fail("EN welcome missing brand icon (cid or hosted app icon)");
  }
  if (en.html.includes("max-width:600px") && en.html.includes("Go to dashboard")) {
    pass("EN welcome uses shared layout width and CTA");
  } else {
    fail("EN welcome layout/CTA");
  }

  const de = buildWelcomeEmailContent({
    locale: "de",
    dashboardUrl,
    businessName: "Hafen Bistro",
    accountKind: "manager",
  });
  includesAll(
    `${de.subject} ${de.html} ${de.text}`,
    [
      "Willkommen bei CareTip",
      "Hafen Bistro",
      "Zum Dashboard",
      "Unternehmensprofil",
      "QR-Codes",
      "Mitarbeitende einladen",
      "Trinkgelder empfangen",
    ],
    "DE manager welcome",
  );

  console.log("=== OAuth Welcome Email Tests ===\n");
  for (const line of results) console.log(line);
  const failures = results.filter((l) => l.startsWith("FAIL:"));
  console.log(failures.length === 0 ? "\nOVERALL: PASS" : "\nOVERALL: FAIL");
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
