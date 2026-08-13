/**
 * Login entry hierarchy: Sign in stays primary; signup starts on the choice screen.
 *
 *   npm run test:auth-entry
 *   npx tsx scripts/auth-entry-runtime.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUTH_LOGIN_VIEWPORTS, isLoginSignInAboveFold } from "../utils/authLoginLayout";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(mobileRoot, rel), "utf8");
}

function main(): void {
  const login = read("features/auth/LoginScreen.tsx");
  const shell = read("components/auth/AuthExperienceShell.tsx");
  const choice = read("features/auth/SignupChoiceScreen.tsx");
  const register = read("features/auth/RegisterScreen.tsx");
  const join = read("features/auth/JoinScreen.tsx");

  assert.match(login, /auth\.signIn/);
  assert.match(login, /auth\.forgotPassword/);
  assert.match(login, /auth\.dontHaveAccount/);
  assert.match(login, /auth\.signUpLink/);
  assert.match(login, /router\.push\("\/\(auth\)\/signup"/);
  assert.doesNotMatch(login, /AuthRegisterSheet/);
  assert.doesNotMatch(login, /auth\.enterInviteCode/);
  assert.doesNotMatch(login, /auth\.register[}"'`]/);
  assert.doesNotMatch(login, /onRegisterPress/);

  assert.match(shell, /auth\.footerMenuTitle/);
  assert.doesNotMatch(shell, /auth\.enterInviteCode/);
  assert.doesNotMatch(shell, /\/\(auth\)\/register/);
  assert.doesNotMatch(shell, /\/\(auth\)\/join/);

  assert.match(choice, /auth\.createAccountTitle/);
  assert.match(choice, /auth\.createAccountSubtitle/);
  assert.match(choice, /auth\.createBusinessChoiceTitle/);
  assert.match(choice, /auth\.joinInviteChoiceTitle/);
  assert.match(choice, /router\.push\("\/\(auth\)\/register"\)/);
  assert.match(choice, /router\.push\("\/\(auth\)\/join"\)/);
  assert.doesNotMatch(choice, /SocialAuthButtons/);
  assert.doesNotMatch(choice, /auth\.fullName/);
  assert.doesNotMatch(choice, /auth\.email/);
  assert.doesNotMatch(choice, /auth\.password/);

  assert.match(register, /authService\.register/);
  assert.match(register, /SocialAuthButtons/);
  assert.match(register, /isLogin:\s*false,\s*intendedRole:\s*"MANAGER"/);
  assert.doesNotMatch(register, /auth\.fullName/);
  assert.match(register, /auth\.backToSignupChoice/);
  assert.match(join, /authService\.validateInviteCode/);
  assert.match(join, /validation\.ok/);
  assert.doesNotMatch(join, /validation\.valid/);
  assert.match(join, /normalizeInviteCode/);
  assert.match(join, /\/\(auth\)\/accept-invite/);
  assert.match(join, /auth\.backToSignupChoice/);

  const accept = read("features/auth/AcceptInviteScreen.tsx");
  assert.match(accept, /\/\(auth\)\/join/);
  assert.doesNotMatch(accept, /router\.replace\("\/\(auth\)\/login"\)/);

  const onboarding = read("features/auth/BusinessOnboardingScreen.tsx");
  assert.match(onboarding, /BackHandler/);
  assert.match(onboarding, /formatOnboardingError/);

  assert.match(login, /isLogin:\s*true/);
  assert.doesNotMatch(login, /isLogin:\s*false,\s*intendedRole:\s*"MANAGER"/);

  const authField = read("components/auth/AuthField.tsx");
  assert.match(login, /secureTextEntry/);
  assert.match(authField, /eye-outline/);
  assert.match(authField, /eye-off-outline/);
  assert.match(authField, /auth\.showPassword/);
  assert.match(authField, /auth\.hidePassword/);

  assert.match(login, /SocialAuthButtons/);
  assert.match(login, /configuredProviders/);
  assert.match(login, /auth\.dontHaveAccount/);
  assert.match(login, /compact/);
  assert.match(login, /authLoginLayout/);
  assert.match(shell, /auth\.brandName/);
  assert.match(shell, /auth\.tagline/);
  assert.match(shell, /auth\.footerMenuTitle/);
  assert.match(shell, /brandRow/);

  const layered = read("components/layout/LayeredScreenShell.tsx");
  assert.doesNotMatch(layered, /isFloating \? 200/);
  assert.match(layered, /!isDashboard && !isFloating/);

  const en = read("i18n/locales/en.ts");
  assert.match(en, /Create Your CareTip Account/);
  assert.match(en, /Choose how you want to get started\./);
  assert.doesNotMatch(en, /Chooses how you want/);

  assert.equal(isLoginSignInAboveFold(AUTH_LOGIN_VIEWPORTS.iPhoneSe, 20), true);
  assert.equal(isLoginSignInAboveFold(AUTH_LOGIN_VIEWPORTS.commonAndroid, 24), true);
  assert.equal(isLoginSignInAboveFold(AUTH_LOGIN_VIEWPORTS.iPhone14, 47), true);
  assert.equal(isLoginSignInAboveFold(AUTH_LOGIN_VIEWPORTS.shortAndroid, 24), true);

  console.log("auth-entry-runtime: OK");
}

main();
