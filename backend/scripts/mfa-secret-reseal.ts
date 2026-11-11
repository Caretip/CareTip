/**
 * Encrypts MFA secrets that are still plaintext, or re-encrypts ones sealed with the previous key.
 * Operator tool. Prints counts only, never secrets or addresses.
 *
 * Run it where the service's own environment is loaded, such as the Render Shell. Never run it from a
 * laptop: backend/.env would override the shell. The output names the database and key in use.
 *
 *   npx tsx scripts/mfa-secret-reseal.ts                                    dry run, writes nothing
 *   npx tsx scripts/mfa-secret-reseal.ts --apply --key-fingerprint=<id>     encrypts
 *   npx tsx scripts/mfa-secret-reseal.ts --restore-plaintext                dry run of a rollback
 *   npx tsx scripts/mfa-secret-reseal.ts --restore-plaintext --apply --key-fingerprint=<id>
 *
 * <id> is the "MFA key fingerprint" the running service logs at startup. Requiring it means a mistyped
 * key can't seal every secret with a key the service doesn't hold.
 *
 * --restore-plaintext is for rolling back to a release without encryption, which can't read sealed
 * values and would lock those users out of MFA. Afterwards the secrets are unprotected again.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import {
  isMfaSecretEncryptionConfigured,
  isSealedMfaSecret,
  mfaKeyFingerprint,
  needsMfaReseal,
  openMfaSecret,
  sealMfaSecret,
} from "../src/lib/mfaSecretCrypto.js";

const apply = process.argv.includes("--apply");
const restore = process.argv.includes("--restore-plaintext");
const givenFingerprint = process.argv.find((a) => a.startsWith("--key-fingerprint="))?.split("=")[1];

if (!isMfaSecretEncryptionConfigured()) {
  console.error("Refusing to run: MFA_SECRET_ENCRYPTION_KEY is not set.");
  process.exit(1);
}

const keyFingerprint = mfaKeyFingerprint();
const database = new URL(process.env.DATABASE_URL ?? "postgresql://unknown").hostname;
if (apply && givenFingerprint !== keyFingerprint) {
  console.error(JSON.stringify({ refused: "--key-fingerprint must match this key", keyFingerprint, database }));
  process.exit(1);
}

const rows = await prisma.user.findMany({
  where: { OR: [{ twoFactorSecret: { not: null } }, { twoFactorTempSecret: { not: null } }] },
  select: { id: true, twoFactorSecret: true, twoFactorTempSecret: true },
});

let pending = 0;
let updated = 0;
let unreadable = 0;
for (const row of rows) {
  for (const field of ["twoFactorSecret", "twoFactorTempSecret"] as const) {
    const stored = row[field];
    if (!stored || !(restore ? isSealedMfaSecret(stored) : needsMfaReseal(stored))) continue;
    pending += 1;
    let replacement: string;
    try {
      const plain = openMfaSecret(stored);
      replacement = restore ? plain : sealMfaSecret(plain);
    } catch {
      unreadable += 1;
      continue;
    }
    if (!apply) continue;
    // Compare-and-set: a login that changed the value first wins.
    const result = await prisma.user.updateMany({ where: { id: row.id, [field]: stored }, data: { [field]: replacement } });
    updated += result.count;
  }
}
console.log(
  JSON.stringify({
    mode: `${restore ? "restore-plaintext" : "encrypt"}:${apply ? "apply" : "dry-run"}`,
    database,
    keyFingerprint,
    accounts: rows.length,
    pending,
    updated,
    unreadable,
  }),
);
await prisma.$disconnect();
process.exit(unreadable > 0 ? 1 : 0);
