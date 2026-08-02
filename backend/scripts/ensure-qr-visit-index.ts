import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

await prisma.$executeRawUnsafe(`
  CREATE UNIQUE INDEX IF NOT EXISTS qr_guest_visits_active_business_session_idx
    ON qr_guest_visits (business_id, session_id)
    WHERE status = 'active'
`);
console.info("[ensure-qr-visit-index] partial unique index ready");
await prisma.$disconnect();
