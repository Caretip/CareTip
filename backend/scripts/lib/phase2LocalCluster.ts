/**
 * Persistent loopback PostgreSQL cluster holding the Phase 2 sanitized validation copy.
 * Lives outside the repository (%LOCALAPPDATA%\caretip-phase2 or ~/.caretip-phase2); never remote.
 */
import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loopbackPostgresUrl } from "./ephemeralIsolatedPostgres.js";

export const PHASE2_LOCAL_PORT = 5434;
export const PHASE2_LOCAL_DB = "caretip_phase2_copy";
const USER = "postgres";

export function phase2StateDir(): string {
  const base = process.env.LOCALAPPDATA?.trim() || join(homedir(), ".local", "share");
  return join(base, "caretip-phase2");
}

type State = { password: string };

function loadOrCreateState(dir: string): State {
  const file = join(dir, "cluster-state.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as State;
  const state: State = { password: randomBytes(18).toString("base64url") };
  writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  return state;
}

export type Phase2LocalCluster = {
  databaseDir: string;
  /** URL of the validation-copy database; contains a local-only password, never log it. */
  connectionUrl: string;
  /** URL of the maintenance database (for CREATE/DROP DATABASE). */
  adminUrl: string;
  stop: () => Promise<void>;
};

export async function startPhase2LocalCluster(): Promise<Phase2LocalCluster> {
  const dir = phase2StateDir();
  mkdirSync(dir, { recursive: true });
  const state = loadOrCreateState(dir);
  const databaseDir = join(dir, "pgdata");
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: USER,
    password: state.password,
    port: PHASE2_LOCAL_PORT,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "timezone=UTC", "-c", "listen_addresses=127.0.0.1"],
    onLog: () => undefined,
    onError: () => undefined,
  });
  if (!existsSync(join(databaseDir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  return {
    databaseDir,
    connectionUrl: loopbackPostgresUrl(USER, state.password, PHASE2_LOCAL_PORT, PHASE2_LOCAL_DB),
    adminUrl: loopbackPostgresUrl(USER, state.password, PHASE2_LOCAL_PORT, "postgres"),
    stop: () => pg.stop(),
  };
}
