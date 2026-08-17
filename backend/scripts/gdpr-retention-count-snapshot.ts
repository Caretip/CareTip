import { prisma } from "../src/prisma.js";

async function main() {
  const counts = {
    Business: await prisma.business.count(),
    User: await prisma.user.count(),
    Employee: await prisma.employee.count(),
    Transaction: await prisma.transaction.count(),
    TipRefund: await prisma.tipRefund.count(),
    StripeConnectPayout: await prisma.stripeConnectPayout.count(),
    SupportTicket: await prisma.supportTicket.count(),
    Notification: await prisma.notification.count(),
    AuditLog: await prisma.auditLog.count(),
    kycRelatedBusinesses: await prisma.business.count({
      where: {
        OR: [{ kycDocuments: { not: null } }, { verificationDocumentPath: { not: null } }],
      },
    }),
  };
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
