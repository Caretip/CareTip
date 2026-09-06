/**
 * Phase 1–9 session / CORS / pagination / demo-bypass regressions.
 * Run: npm run test:phase-01-09-session (backend)
 */
import {
  accessTokenMissingRequiredSessionBind,
  buildImpersonationJwtPayload,
  IMPERSONATION_JWT_TYPE,
} from "../src/lib/jwtConfig.js";
import { isDemoEmailVerificationBypassEnabled } from "../src/services/emailVerificationBypass.flags.js";
import { corsMiddlewareOptions, isCorsOriginAllowed } from "../src/config/cors.js";
import { MAX_LIST_SKIP, parseBoundedSkip } from "../src/utils/paginationLimits.js";

type CaseResult = { id: string; pass: boolean; detail: string };

const results: CaseResult[] = [];
const pass = (id: string, detail: string) => results.push({ id, pass: true, detail });
const fail = (id: string, detail: string) => results.push({ id, pass: false, detail });

function withEnv<T>(key: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

function run() {
  const claims = buildImpersonationJwtPayload({
    targetUserId: "user-target",
    platformAdminUserId: "user-admin",
    authTokenVersion: 7,
    refreshSessionId: "sid-refresh-row",
  });
  if (
    claims.type === IMPERSONATION_JWT_TYPE &&
    claims.tv === 7 &&
    claims.sid === "sid-refresh-row" &&
    claims.sub === "user-target"
  ) {
    pass("auth-01-impersonation-claims", "Impersonation JWT payload includes tv and sid");
  } else {
    fail("auth-01-impersonation-claims", JSON.stringify(claims));
  }

  if (
    accessTokenMissingRequiredSessionBind({
      type: IMPERSONATION_JWT_TYPE,
      tv: 1,
    })
  ) {
    pass("auth-01-impersonation-requires-sid", "Impersonation without sid is stale");
  } else {
    fail("auth-01-impersonation-requires-sid", "sid-less impersonation accepted");
  }

  if (
    !accessTokenMissingRequiredSessionBind({
      type: IMPERSONATION_JWT_TYPE,
      tv: 1,
      sid: "abc",
    })
  ) {
    pass("auth-01-impersonation-bound-ok", "Bound impersonation claims accepted");
  } else {
    fail("auth-01-impersonation-bound-ok", "Valid impersonation claims rejected");
  }

  withEnv("NODE_ENV", "development", () => {
    withEnv("ENABLE_DEMO_BYPASS", undefined, () => {
      if (!isDemoEmailVerificationBypassEnabled()) {
        pass("auth-02-dev-no-implicit-bypass", "Development does not enable email verify bypass without flag");
      } else {
        fail("auth-02-dev-no-implicit-bypass", "Bypass enabled without ENABLE_DEMO_BYPASS");
      }
    });
    withEnv("ENABLE_DEMO_BYPASS", "true", () => {
      if (isDemoEmailVerificationBypassEnabled()) {
        pass("auth-02-explicit-flag", "ENABLE_DEMO_BYPASS=true enables bypass");
      } else {
        fail("auth-02-explicit-flag", "Flag did not enable bypass");
      }
    });
  });

  withEnv("NODE_ENV", "production", () => {
    if (
      accessTokenMissingRequiredSessionBind({
        type: "access",
        tv: 1,
      })
    ) {
      pass("auth-03-prod-requires-sid", "Production access JWT without sid is stale");
    } else {
      fail("auth-03-prod-requires-sid", "sid-less access allowed in production");
    }

    if (!isCorsOriginAllowed("http://localhost:9999")) {
      pass("csrf-01-prod-no-localhost-trust", "Production does not trust arbitrary localhost origins");
    } else {
      fail("csrf-01-prod-no-localhost-trust", "localhost:9999 allowed in production CORS");
    }
  });

  const exposed = (corsMiddlewareOptions as { exposedHeaders?: string[] }).exposedHeaders;
  if (!exposed || !exposed.includes("X-CareTip-Refresh")) {
    pass("auth-08-cors-no-refresh-expose", "CORS does not expose X-CareTip-Refresh");
  } else {
    fail("auth-08-cors-no-refresh-expose", "Refresh header still CORS-exposed");
  }

  if (parseBoundedSkip(999_999) === MAX_LIST_SKIP && parseBoundedSkip(-3) === 0) {
    pass("api-03-skip-cap", `skip capped at ${MAX_LIST_SKIP}`);
  } else {
    fail("api-03-skip-cap", String(parseBoundedSkip(999_999)));
  }
}

run();
console.log("=== Phase 1–9 session/CORS/pagination regressions ===\n");
for (const r of results) {
  console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
}
const failures = results.filter((r) => !r.pass);
console.log(`\nSummary: ${results.length} tests, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
