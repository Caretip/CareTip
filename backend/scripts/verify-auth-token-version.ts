/**
 * Verify auth_token_version column + JWT `tv` claim after migration.
 * Run: npx dotenv -e ../.env -e .env -- tsx scripts/verify-auth-token-version.ts
 */
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { authResultForUserId } from "../src/services/auth.service.js";

async function main() {
  const user = await prisma.user.findFirst({
    where: { isActive: true, emailVerified: true },
    select: { id: true, email: true, role: true, authTokenVersion: true },
  });
  if (!user) {
    console.error("No verified active user for JWT check");
    process.exit(1);
  }

  console.log("DB authTokenVersion:", user.authTokenVersion, "user:", user.email);

  const { token } = await authResultForUserId(user.id, { refreshSessionId: "verify-only" });
  const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as {
    sub?: string;
    type?: string;
    tv?: number;
    role?: string;
    sid?: string;
  };

  console.log("JWT claims:", {
    sub: payload.sub,
    type: payload.type,
    tv: payload.tv,
    role: payload.role,
    sid: payload.sid,
  });

  if (payload.tv !== user.authTokenVersion) {
    console.error("tv mismatch");
    process.exit(1);
  }
  if (payload.type !== "access") {
    console.error("missing type access");
    process.exit(1);
  }
  console.log("OK: JWT generation includes token version");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
