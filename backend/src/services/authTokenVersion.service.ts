import { prisma } from "../prisma.js";

/** Bumps global auth token version — invalidates all access JWTs that carry a `tv` claim. */
export async function bumpAuthTokenVersion(userId: string): Promise<number> {
  const row = await prisma.user.update({
    where: { id: userId },
    data: { authTokenVersion: { increment: 1 } },
    select: { authTokenVersion: true },
  });
  return row.authTokenVersion;
}
