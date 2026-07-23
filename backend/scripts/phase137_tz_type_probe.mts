import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

async function main() {
  const typ = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_name = 'tips' AND column_name = 'created_at'`,
  );
  console.log("column type", JSON.stringify(typ, null, 2));

  const probe = await prisma.$queryRawUnsafe(
    `SELECT
       created_at::text AS stored,
       pg_typeof(created_at)::text AS typ,
       (created_at AT TIME ZONE 'Europe/Berlin')::text AS as_berlin_direct,
       ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin')::text AS utc_then_berlin,
       to_char(date_trunc('day', created_at AT TIME ZONE 'Europe/Berlin'), 'YYYY-MM-DD') AS broken_day,
       to_char(date_trunc('day', (created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin'), 'YYYY-MM-DD') AS fixed_day
     FROM tips
     WHERE id = 'cmrwn4ll400i5ms48abz1v6kk'`,
  );
  console.log("probe", JSON.stringify(probe, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
