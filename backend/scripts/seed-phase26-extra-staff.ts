/**
 * Add 9 login-ready staff to the Phase26 E2E business (mgr_p26_1786691378148).
 * Run from backend: npx tsx scripts/seed-phase26-extra-staff.ts
 */
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";

const MANAGER_EMAIL = "mgr_p26_1786691378148@caretip-test.local";
const PASSWORD = "Phase26E2E!23";
const TAG = "p26_1786691378148";

const STAFF = [
  {
    key: "jordan",
    email: `jordan.${TAG}@caretip-test.local`,
    name: "Jordan Park",
    jobTitle: "Host",
    phone: "+49 30 11110001",
    monthlyGoal: 420,
    bio: "Greets guests at the door and seats the floor with a calm, premium service style.",
    avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=400&fit=crop&crop=face",
  },
  {
    key: "luca",
    email: `luca.${TAG}@caretip-test.local`,
    name: "Luca Fischer",
    jobTitle: "Sous chef",
    phone: "+49 30 11110002",
    monthlyGoal: 510,
    bio: "Runs the pass on busy nights and keeps the kitchen line precise and on time.",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=face",
  },
  {
    key: "maria",
    email: `maria.${TAG}@caretip-test.local`,
    name: "Maria Schneider",
    jobTitle: "Head server",
    phone: "+49 30 11110003",
    monthlyGoal: 560,
    bio: "Leads the dining room and looks after regulars with attentive, unhurried service.",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop&crop=face",
  },
  {
    key: "sam",
    email: `sam.${TAG}@caretip-test.local`,
    name: "Sam Winters",
    jobTitle: "Bartender",
    phone: "+49 30 11110004",
    monthlyGoal: 480,
    bio: "Builds classic cocktails and keeps the bar moving without rushing guests.",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop&crop=face",
  },
  {
    key: "sarah",
    email: `sarah.${TAG}@caretip-test.local`,
    name: "Sarah Klein",
    jobTitle: "Senior server",
    phone: "+49 30 11110005",
    monthlyGoal: 450,
    bio: "Handles larger tables and tasting menus with a warm, detail-first approach.",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop&crop=face",
  },
  {
    key: "noah",
    email: `noah.${TAG}@caretip-test.local`,
    name: "Noah Stein",
    jobTitle: "Sommelier",
    phone: "+49 30 11110006",
    monthlyGoal: 530,
    bio: "Guides wine pairings and keeps the cellar list accurate for service.",
    avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop&crop=face",
  },
  {
    key: "lena",
    email: `lena.${TAG}@caretip-test.local`,
    name: "Lena Hoffmann",
    jobTitle: "Pastry chef",
    phone: "+49 30 11110007",
    monthlyGoal: 400,
    bio: "Finishes desserts for the room and supports the pastry station through service.",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=400&fit=crop&crop=face",
  },
  {
    key: "omar",
    email: `omar.${TAG}@caretip-test.local`,
    name: "Omar Hassan",
    jobTitle: "Floor manager",
    phone: "+49 30 11110008",
    monthlyGoal: 390,
    bio: "Coordinates stations, covers breaks, and keeps service timing tight.",
    avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=400&fit=crop&crop=face",
  },
  {
    key: "iris",
    email: `iris.${TAG}@caretip-test.local`,
    name: "Iris Dubois",
    jobTitle: "Reception",
    phone: "+49 30 11110009",
    monthlyGoal: 360,
    bio: "Takes bookings, welcomes walk-ins, and keeps the front desk calm at peak times.",
    avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=400&fit=crop&crop=face",
  },
] as const;

async function main() {
  const manager = await prisma.user.findUnique({
    where: { email: MANAGER_EMAIL },
    include: { business: true },
  });
  if (!manager?.business) {
    throw new Error(`No business found for ${MANAGER_EMAIL}`);
  }

  const business = manager.business;
  const location = await prisma.location.findFirst({
    where: { businessId: business.id },
    select: { id: true },
  });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const created: Array<{ name: string; email: string; jobTitle: string }> = [];

  for (const s of STAFF) {
    const slug = `${TAG}-${s.key}`.toLowerCase();
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: {
        role: "EMPLOYEE",
        isActive: true,
        isPlatformAdmin: false,
        emailVerified: true,
        hasCompletedOnboarding: true,
        passwordHash,
      },
      create: {
        email: s.email,
        passwordHash,
        role: "EMPLOYEE",
        isActive: true,
        isPlatformAdmin: false,
        emailVerified: true,
        hasCompletedOnboarding: true,
      },
    });

    await prisma.employee.upsert({
      where: { userId: user.id },
      update: {
        name: s.name,
        jobTitle: s.jobTitle,
        slug,
        bio: s.bio,
        avatar: s.avatar,
        phone: s.phone,
        monthlyGoal: s.monthlyGoal,
        businessId: business.id,
        locationId: location?.id ?? null,
        isActive: true,
        activationStatus: "active",
        isDeleted: false,
        deletedAt: null,
        emailNotifications: true,
        pushNotifications: true,
      },
      create: {
        name: s.name,
        jobTitle: s.jobTitle,
        slug,
        bio: s.bio,
        avatar: s.avatar,
        phone: s.phone,
        monthlyGoal: s.monthlyGoal,
        businessId: business.id,
        userId: user.id,
        locationId: location?.id ?? null,
        isActive: true,
        activationStatus: "active",
        emailNotifications: true,
        pushNotifications: true,
      },
    });

    created.push({ name: s.name, email: s.email, jobTitle: s.jobTitle });
  }

  const staffCount = await prisma.employee.count({
    where: { businessId: business.id, isDeleted: false },
  });

  console.log(JSON.stringify({ businessId: business.id, businessName: business.name, staffCount, seeded: created }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
