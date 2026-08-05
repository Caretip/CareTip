/**
 * Auth hero / marketing panel copy — single source of truth by lane + scene.
 * Select content via route helpers or explicit `marketingScene` on layouts.
 */

export type AuthLane = "business" | "employee";

export type AuthMarketingScene =
  | "signIn"
  | "signUp"
  | "invite"
  | "passwordSetup"
  | "activation"
  | "verification"
  | "recovery"
  | "passwordReset"
  | "otp";

export type AuthMarketingContent = {
  scene: AuthMarketingScene;
  /** i18n key prefix, e.g. `auth.marketing.signIn` → `.badge`, `.headline`, … */
  i18nPrefix: string;
};

const BUSINESS_PREFIX = "auth.marketing";
const EMPLOYEE_PREFIX = "auth.employeeMarketing";

export const BUSINESS_AUTH_CONTENT: Record<AuthMarketingScene, AuthMarketingContent> = {
  signIn: { scene: "signIn", i18nPrefix: `${BUSINESS_PREFIX}.signIn` },
  signUp: { scene: "signUp", i18nPrefix: `${BUSINESS_PREFIX}.signUp` },
  invite: { scene: "signUp", i18nPrefix: `${BUSINESS_PREFIX}.signUp` },
  passwordSetup: { scene: "signUp", i18nPrefix: `${BUSINESS_PREFIX}.signUp` },
  activation: { scene: "signUp", i18nPrefix: `${BUSINESS_PREFIX}.signUp` },
  verification: { scene: "verification", i18nPrefix: `${BUSINESS_PREFIX}.verification` },
  recovery: { scene: "recovery", i18nPrefix: `${BUSINESS_PREFIX}.recovery` },
  passwordReset: { scene: "passwordReset", i18nPrefix: `${BUSINESS_PREFIX}.passwordReset` },
  otp: { scene: "otp", i18nPrefix: `${BUSINESS_PREFIX}.otp` },
};

export const EMPLOYEE_AUTH_CONTENT: Record<AuthMarketingScene, AuthMarketingContent> = {
  signIn: { scene: "signIn", i18nPrefix: `${EMPLOYEE_PREFIX}.signIn` },
  signUp: { scene: "signUp", i18nPrefix: `${EMPLOYEE_PREFIX}.signUp` },
  invite: { scene: "invite", i18nPrefix: `${EMPLOYEE_PREFIX}.invite` },
  passwordSetup: { scene: "passwordSetup", i18nPrefix: `${EMPLOYEE_PREFIX}.passwordSetup` },
  activation: { scene: "activation", i18nPrefix: `${EMPLOYEE_PREFIX}.activation` },
  verification: { scene: "verification", i18nPrefix: `${EMPLOYEE_PREFIX}.verification` },
  recovery: { scene: "recovery", i18nPrefix: `${EMPLOYEE_PREFIX}.recovery` },
  passwordReset: { scene: "passwordReset", i18nPrefix: `${EMPLOYEE_PREFIX}.passwordReset` },
  otp: { scene: "otp", i18nPrefix: `${EMPLOYEE_PREFIX}.otp` },
};

export function getAuthMarketingContent(
  lane: AuthLane,
  scene: AuthMarketingScene,
): AuthMarketingContent {
  const map = lane === "employee" ? EMPLOYEE_AUTH_CONTENT : BUSINESS_AUTH_CONTENT;
  return map[scene];
}

export function resolveMarketingSceneFromSignUpMode(signUpMode: boolean): AuthMarketingScene {
  return signUpMode ? "signUp" : "signIn";
}

type RouteMarketingRule = {
  match: (pathname: string) => boolean;
  lane: AuthLane;
  scene: AuthMarketingScene;
};

/** Default lane + scene when no explicit override is passed to a layout. */
export const AUTH_ROUTE_MARKETING: RouteMarketingRule[] = [
  { match: (p) => p === "/employee/login", lane: "employee", scene: "signIn" },
  { match: (p) => p === "/join/signup", lane: "employee", scene: "signUp" },
  {
    match: (p) => p === "/join" || (p.startsWith("/join/") && p !== "/join/signup"),
    lane: "employee",
    scene: "invite",
  },
  { match: (p) => p === "/activate", lane: "employee", scene: "passwordSetup" },
  { match: (p) => p === "/verify-email" || p === "/verify", lane: "business", scene: "verification" },
  { match: (p) => p === "/signup", lane: "business", scene: "signUp" },
  { match: (p) => p === "/login" || p === "/auth", lane: "business", scene: "signIn" },
  { match: (p) => p === "/forgot-password", lane: "business", scene: "recovery" },
  { match: (p) => p.startsWith("/reset-password/"), lane: "business", scene: "passwordReset" },
];

export function resolveAuthMarketingFromPath(pathname: string): {
  lane: AuthLane;
  scene: AuthMarketingScene;
} {
  for (const rule of AUTH_ROUTE_MARKETING) {
    if (rule.match(pathname)) return { lane: rule.lane, scene: rule.scene };
  }
  return { lane: "business", scene: "signIn" };
}

/** Email verification is shared by business and employee sign-up — use session role when known. */
export function resolveVerificationMarketingLane(
  role: "business" | "employee" | "platform_admin" | "admin" | "user" | undefined,
): AuthLane {
  return role === "employee" ? "employee" : "business";
}
