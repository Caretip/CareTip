/**
 * ESM equivalent of `require("dotenv").config()` — must load before `process.env` is read.
 * `dotenv/config` loads `backend/.env` when cwd is `backend/`; then we merge repo root + backend.
 * Merge **repo root `.env`** then **`backend/.env`** (backend wins on duplicate keys).
 * Do not reload env on each request — overriding can clear `JWT_SECRET` if `backend/.env` sets it empty.
 */
import "dotenv/config";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendEnv = join(__dirname, "../.env");
const rootEnv = join(__dirname, "../../.env");

export function applyEnvFiles(): void {
  // scripts/safe-test.mjs: `override` below would otherwise replace the isolated values with real ones.
  if (process.env.CARETIP_TEST_ISOLATION === "1") return;
  if (existsSync(rootEnv)) {
    config({ path: rootEnv, quiet: true });
  }
  if (existsSync(backendEnv)) {
    config({ path: backendEnv, override: true, quiet: true });
  }
  if (!existsSync(rootEnv) && !existsSync(backendEnv)) {
    config({ quiet: true });
  }
}

applyEnvFiles();

if (process.env.NODE_ENV !== "production") {
  const u = process.env.DATABASE_URL?.trim();
  if (u?.includes("pooler.supabase.com:5432") && process.env.DATABASE_USE_SESSION_POOLER !== "true") {
    console.warn(
      "[env] DATABASE_URL uses Supabase session pooler (5432). Prefer transaction pooler (6543) in Render env, or let the API rewrite at runtime.",
    );
  }
  if (u) {
    try {
      const parsed = new URL(u.replace(/^postgresql:\/\//i, "http://"));
      const port = parsed.port || (parsed.protocol === "http:" ? "80" : "");
      const portLabel = port ? `:${port}` : "";
      console.log(`DATABASE_URL target (debug): ${parsed.hostname}${portLabel}`);
      if (parsed.hostname.includes("pooler.supabase.com")) {
        console.log(`(pooler mode: port ${parsed.port || "default"})`);
      }
    } catch {
      console.log("DATABASE_URL: set (host parse skipped)");
    }
  } else {
    console.log("DATABASE_URL: MISSING");
  }
}
