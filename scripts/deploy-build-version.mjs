/**
 * Build-time deployment identifier for the SPA. Embedded through Vite `define` and emitted as
 * `dist/version.json` so open tabs can detect a newer Netlify deploy.
 * Only public, non-secret values are read: Netlify's COMMIT_REF and BUILD_ID (or DEPLOY_ID).
 */
import { execFileSync } from "node:child_process";

export const DEPLOY_VERSION_FILE = "version.json";

const SAFE_SEGMENT = /[^A-Za-z0-9._-]/g;

/** @param {unknown} raw */
function cleanSegment(raw, max) {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(SAFE_SEGMENT, "").slice(0, max);
}

/** @param {string} cwd */
export function readLocalGitSha(cwd) {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    return cleanSegment(out, 40);
  } catch {
    return "";
  }
}

/**
 * @param {{ env?: Record<string, string | undefined>, now?: Date, gitSha?: string }} [input]
 * @returns {{ version: string, buildTime: string }}
 */
export function resolveDeployBuildInfo(input = {}) {
  const env = input.env ?? {};
  const now = input.now ?? new Date();
  const buildTime = now.toISOString();
  const sha = cleanSegment(env.COMMIT_REF, 40) || cleanSegment(input.gitSha, 40);
  const shortSha = sha.slice(0, 12) || "local";
  const buildId = cleanSegment(env.BUILD_ID, 40) || cleanSegment(env.DEPLOY_ID, 40);
  const unique = buildId || now.getTime().toString(36);
  return { version: `${shortSha}-${unique}`, buildTime };
}

/** @param {{ version: string, buildTime: string }} info */
export function deployVersionJson(info) {
  return `${JSON.stringify({ version: info.version, buildTime: info.buildTime }, null, 2)}\n`;
}

/**
 * Emits `version.json` into the build output. Build only; dev servers report version "dev".
 * @param {{ version: string, buildTime: string }} info
 */
export function deployVersionPlugin(info) {
  return {
    name: "caretip-deploy-version",
    apply: /** @type {const} */ ("build"),
    generateBundle() {
      this.emitFile({ type: "asset", fileName: DEPLOY_VERSION_FILE, source: deployVersionJson(info) });
    },
  };
}
