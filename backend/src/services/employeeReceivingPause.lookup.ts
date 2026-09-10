import { prisma } from "../prisma.js";

/**
 * CareTip QR pause flag. Uses SQL so a stale Prisma client (pre-generate)
 * still works after the receiving_paused_at migration.
 */
export async function readCareTipReceivingPaused(employeeId: string): Promise<boolean> {
  const id = employeeId.trim();
  if (!id) return false;
  try {
    const rows = await prisma.$queryRaw<Array<{ receiving_paused_at: Date | null }>>`
      SELECT receiving_paused_at FROM employees WHERE id = ${id} LIMIT 1
    `;
    return rows[0]?.receiving_paused_at != null;
  } catch {
    return false;
  }
}
