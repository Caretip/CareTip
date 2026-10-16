import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EPHEMERAL_PORT = 5433;
const EPHEMERAL_USER = "postgres";

export type EphemeralIsolatedPostgres = {
  /** Disposable local URL — never log password in production tooling. */
  connectionUrl: string;
  port: number;
  /** Fresh temp cluster directory; lets child processes prove which server they are connected to. */
  databaseDir: string;
  stop: () => Promise<void>;
};

/**
 * Starts a throwaway PostgreSQL cluster on localhost (Windows/macOS/Linux via embedded-postgres).
 * For local certification only — not shared staging/production.
 */
export async function startEphemeralIsolatedPostgres(): Promise<EphemeralIsolatedPostgres> {
  const password = `ephemeral_${randomToken()}`;
  const databaseDir = mkdtempSync(join(tmpdir(), "caretip-ephemeral-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: EPHEMERAL_USER,
    password,
    port: EPHEMERAL_PORT,
    persistent: false,
    // Windows default cluster encoding is WIN1252; CareTip migrations include UTF-8 text.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    // Columns are TIMESTAMP without time zone; raw SQL Date params are cast via the session
    // TimeZone, so the cluster must run in UTC like production instead of the host's local zone.
    postgresFlags: ["-c", "timezone=UTC"],
    onLog: () => undefined,
    onError: () => undefined,
  });

  await pg.initialise();
  await pg.start();

  const connectionUrl = `postgresql://${EPHEMERAL_USER}:${encodeURIComponent(password)}@127.0.0.1:${EPHEMERAL_PORT}/postgres`;

  return {
    connectionUrl,
    port: EPHEMERAL_PORT,
    databaseDir,
    stop: async () => {
      try {
        await pg.stop();
      } finally {
        rmSync(databaseDir, { recursive: true, force: true });
      }
    },
  };
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 14);
}
