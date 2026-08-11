/**
 * Login entry hierarchy: Sign in stays primary; signup shortcuts are not on Login.
 *
 *   npm run test:auth-entry
 *   npx tsx scripts/auth-entry-runtime.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(mobileRoot, rel), "utf8");
}

function main(): void {
  const login = read("features/auth/LoginScreen.tsx");
  const shell = read("components/auth/AuthExperienceShell.tsx");
  const sheet = read("components/auth/AuthRegisterSheet.tsx");
  const register = read("features/auth/RegisterScreen.tsx");
  const join = read("features/auth/JoinScreen.tsx");

  assert.match(login, /auth\.signIn/);
  assert.match(login, /auth\.forgotPassword/);
  assert.match(login, /auth\.dontHaveAccount/);
  assert.match(login, /auth\.signUpLink/);
  assert.match(login, /setRegisterOpen\(true\)/);
  assert.doesNotMatch(login, /auth\.enterInviteCode/);
  assert.doesNotMatch(login, /auth\.register[}"'`]/);
  assert.doesNotMatch(login, /onRegisterPress/);

  assert.match(shell, /auth\.footerMenuTitle/);
  assert.doesNotMatch(shell, /auth\.enterInviteCode/);
  assert.doesNotMatch(shell, /\/\(auth\)\/register/);
  assert.doesNotMatch(shell, /\/\(auth\)\/join/);

  assert.match(sheet, /auth\.createBusinessChoiceTitle/);
  assert.match(sheet, /auth\.joinInviteChoiceTitle/);
  assert.match(sheet, /router\.push\("\/\(auth\)\/register"\)/);
  assert.match(sheet, /router\.push\("\/\(auth\)\/join"\)/);
  assert.match(sheet, /SocialAuthButtons/);
  assert.match(sheet, /onRequestClose=\{onClose\}/);

  assert.match(register, /authService\.register/);
  assert.match(register, /router\.replace\("\/\(auth\)\/login"\)/);
  assert.match(join, /authService\.validateInviteCode/);
  assert.match(join, /\/\(auth\)\/accept-invite/);
  assert.match(join, /router\.replace\("\/\(auth\)\/login"\)/);

  assert.match(login, /isLogin:\s*true/);
  assert.match(login, /isLogin:\s*false,\s*intendedRole:\s*"MANAGER"/);

  const authField = read("components/auth/AuthField.tsx");
  assert.match(login, /secureTextEntry/);
  assert.match(authField, /eye-outline/);
  assert.match(authField, /eye-off-outline/);
  assert.match(authField, /auth\.showPassword/);
  assert.match(authField, /auth\.hidePassword/);

  console.log("auth-entry-runtime: OK");
}

main();
