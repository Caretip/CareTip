import { prisma } from "../../prisma.js";

/** True only after a successful check. A missing column is rechecked so a later migration is picked up. */
let tipChannelColumnsReady: boolean | null = null;

/**
 * The tip-channel columns are added by a migration that may land after this code.
 * Callers must keep the previous tip behavior until the columns exist.
 */
export async function employeeTipChannelColumnsReady(): Promise<boolean> {
  if (tipChannelColumnsReady === true) return true;
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'employees'
        AND column_name = 'tip_in_app_notifications'
    ) AS ready
  `;
  const value = rows[0]?.ready as boolean | string | undefined;
  const ready = value === true || value === "t" || value === "true";
  if (ready) tipChannelColumnsReady = true;
  return ready;
}

/** Fields to clear on erasure. Omitted until the migration has added the columns. */
export async function clearedEmployeeTipChannelData(): Promise<
  | {
      tipInAppNotifications: false;
      tipPushNotifications: false;
      tipEmailNotifications: false;
    }
  | Record<string, never>
> {
  if (!(await employeeTipChannelColumnsReady())) return {};
  return {
    tipInAppNotifications: false,
    tipPushNotifications: false,
    tipEmailNotifications: false,
  };
}
