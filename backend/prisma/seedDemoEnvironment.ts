/**
 * CareTip demo environment — 5 businesses × 5 employees, consistent across dashboards.
 * Idempotent upserts; safe to re-run via `npm run db:seed`.
 */
import bcrypt from "bcrypt";
import { DateTime } from "luxon";
import {
  BillingCycle,
  type BusinessSubscriptionTier,
  type KycVerificationStatus,
  type OnboardingVerificationStatus,
  type PrismaClient,
  SubscriptionEventProcessingResult,
  SubscriptionStatus,
} from "@prisma/client";
import { mapBusinessTierToPlanKey } from "../src/lib/subscription/mapSubscriptionPlanKey.js";
import { seedPlatformAdminTeam } from "./seedPlatformAdminTeam.js";
import { seedDemoActivityCenter } from "./seedDemoActivityCenter.js";

export const DEMO_PASSWORD = "Demo1234!";
export const DEMO_ADMIN_EMAIL = "admin@caretip.de".toLowerCase();
export const DEMO_MANAGER_EMAIL = "demo@caretip.de".toLowerCase();
export const DEMO_EMPLOYEE_EMAIL = "employee@caretip.de".toLowerCase();

/** @deprecated Use DEMO_* exports — kept for scripts importing walkthrough constants. */
export const WALKTHROUGH_DEMO_MANAGER_PASSWORD = DEMO_PASSWORD;
export const WALKTHROUGH_DEMO_MANAGER_EMAIL = DEMO_MANAGER_EMAIL;
export const WALKTHROUGH_DEMO_EMPLOYEE_EMAIL = DEMO_EMPLOYEE_EMAIL;
export const WALKTHROUGH_DEMO_ADMIN_EMAIL = DEMO_ADMIN_EMAIL;

const EMPLOYEES_PER_BUSINESS = 5;

const PRIMARY_LOCATION_MAIN_ID = "clwkdemov2locmain01xxxxx";
const PRIMARY_LOCATION_GARDEN_ID = "clwkdemov2locgart01xxxxx";
const PRIMARY_TABLE_QR_MAIN = "wd-brasserie-table-main-01";
const PRIMARY_TABLE_QR_GARDEN = "wd-brasserie-table-patio-02";
const PRIMARY_DEMO_EMPLOYEE_SLUG = "wd-brasserie-employee-demo";

type DemoBusinessConfig = {
  key: string;
  id: string;
  slug: string;
  name: string;
  businessType: string;
  location: string;
  registeredAddress: string;
  managerEmail: string;
  inviteCode: string;
  subscriptionTier: BusinessSubscriptionTier;
  verificationStatus: "pending" | "verified" | "rejected";
  onboardingVerificationStatus: OnboardingVerificationStatus;
  kycVerificationStatus: KycVerificationStatus;
  tipCount: number;
  feedbackCount: number;
  isPrimary?: boolean;
};

type StaffSeed = {
  email: string;
  name: string;
  jobTitle: string;
  slug: string;
  avatar: string;
  monthlyGoal: number;
  isDemoLogin?: boolean;
};

const DEMO_BUSINESSES: DemoBusinessConfig[] = [
  {
    key: "brasserie",
    id: "cldemo_business_brasserie01",
    slug: "brasserie-lindenstrasse",
    name: "Brasserie Lindenstraße",
    businessType: "Restaurant",
    location: "Berlin-Mitte, Germany",
    registeredAddress: "Lindenstraße 42, 10969 Berlin",
    managerEmail: DEMO_MANAGER_EMAIL,
    inviteCode: "WDEM42",
    subscriptionTier: "premium",
    verificationStatus: "verified",
    onboardingVerificationStatus: "approved",
    kycVerificationStatus: "verified",
    tipCount: 96,
    feedbackCount: 24,
    isPrimary: true,
  },
  {
    key: "harbor",
    id: "cldemo_business_harbor01xx",
    slug: "harbor-spa-wellness",
    name: "Harbor Spa & Wellness",
    businessType: "Spa",
    location: "Hamburg, Germany",
    registeredAddress: "Hafenstraße 8, 20459 Hamburg",
    managerEmail: "harbor.demo@caretip.de",
    inviteCode: "HARB01",
    subscriptionTier: "enterprise",
    verificationStatus: "verified",
    onboardingVerificationStatus: "approved",
    kycVerificationStatus: "verified",
    tipCount: 48,
    feedbackCount: 12,
  },
  {
    key: "salon",
    id: "cldemo_business_salon01xxx",
    slug: "city-salon-collective",
    name: "City Salon Collective",
    businessType: "Salon",
    location: "Munich, Germany",
    registeredAddress: "Sendlinger Straße 14, 80331 München",
    managerEmail: "salon.demo@caretip.de",
    inviteCode: "SLON42",
    subscriptionTier: "premium",
    verificationStatus: "pending",
    onboardingVerificationStatus: "submitted",
    kycVerificationStatus: "pending_review",
    tipCount: 36,
    feedbackCount: 8,
  },
  {
    key: "alpine",
    id: "cldemo_business_alpine01xx",
    slug: "alpine-chalet-hotel",
    name: "Alpine Chalet Hotel",
    businessType: "Hotel",
    location: "Garmisch-Partenkirchen, Germany",
    registeredAddress: "Zugspitzstraße 2, 82467 Garmisch-Partenkirchen",
    managerEmail: "alpine.demo@caretip.de",
    inviteCode: "ALPN01",
    subscriptionTier: "basic",
    verificationStatus: "pending",
    onboardingVerificationStatus: "draft",
    kycVerificationStatus: "not_started",
    tipCount: 12,
    feedbackCount: 2,
  },
  {
    key: "riverside",
    id: "cldemo_business_river01xxx",
    slug: "riverside-cafe-koeln",
    name: "Riverside Café",
    businessType: "Café",
    location: "Cologne, Germany",
    registeredAddress: "Rheinufer 3, 50679 Köln",
    managerEmail: "riverside.demo@caretip.de",
    inviteCode: "RIV01",
    subscriptionTier: "basic",
    verificationStatus: "rejected",
    onboardingVerificationStatus: "rejected",
    kycVerificationStatus: "rejected",
    tipCount: 8,
    feedbackCount: 0,
  },
];

const PRIMARY_STAFF: StaffSeed[] = [
  {
    email: DEMO_EMPLOYEE_EMAIL,
    name: "Mina Schmidt",
    jobTitle: "Senior server",
    slug: PRIMARY_DEMO_EMPLOYEE_SLUG,
    avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&h=150&fit=crop&crop=face",
    monthlyGoal: 650,
    isDemoLogin: true,
  },
  {
    email: "anna.staff.demo@caretip.de",
    name: "Maria Schneider",
    jobTitle: "Head server",
    slug: "wd-brasserie-anna",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop&crop=face",
    monthlyGoal: 620,
  },
  {
    email: "sam.staff.demo@caretip.de",
    name: "Sam Winters",
    jobTitle: "Bartender",
    slug: "wd-brasserie-sam",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face",
    monthlyGoal: 500,
  },
  {
    email: "jordan.staff.demo@caretip.de",
    name: "Jordan Park",
    jobTitle: "Host",
    slug: "wd-brasserie-jordan",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=face",
    monthlyGoal: 420,
  },
  {
    email: "luca.staff.demo@caretip.de",
    name: "Luca Fischer",
    jobTitle: "Sous chef",
    slug: "wd-brasserie-luca",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=face",
    monthlyGoal: 480,
  },
];

const SECONDARY_STAFF_ROSTERS: Record<string, StaffSeed[]> = {
  harbor: [
    { email: "nina.harbor.demo@caretip.de", name: "Nina Vogel", jobTitle: "Spa therapist", slug: "harbor-nina", avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop&crop=face", monthlyGoal: 520 },
    { email: "leo.harbor.demo@caretip.de", name: "Leo Hartmann", jobTitle: "Wellness attendant", slug: "harbor-leo", avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&h=150&fit=crop&crop=face", monthlyGoal: 450 },
    { email: "eva.harbor.demo@caretip.de", name: "Eva Lindström", jobTitle: "Front desk", slug: "harbor-eva", avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&h=150&fit=crop&crop=face", monthlyGoal: 400 },
    { email: "finn.harbor.demo@caretip.de", name: "Finn Okafor", jobTitle: "Pool attendant", slug: "harbor-finn", avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face", monthlyGoal: 380 },
    { email: "mia.harbor.demo@caretip.de", name: "Mia Keller", jobTitle: "Massage therapist", slug: "harbor-mia", avatar: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&h=150&fit=crop&crop=face", monthlyGoal: 560 },
  ],
  salon: [
    { email: "zoe.salon.demo@caretip.de", name: "Zoe Martinez", jobTitle: "Senior stylist", slug: "salon-zoe", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop&crop=face", monthlyGoal: 580 },
    { email: "kai.salon.demo@caretip.de", name: "Kai Nguyen", jobTitle: "Colorist", slug: "salon-kai", avatar: "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&h=150&fit=crop&crop=face", monthlyGoal: 510 },
    { email: "iris.salon.demo@caretip.de", name: "Iris Dubois", jobTitle: "Receptionist", slug: "salon-iris", avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=face", monthlyGoal: 360 },
    { email: "noah.salon.demo@caretip.de", name: "Noah Stein", jobTitle: "Barber", slug: "salon-noah", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face", monthlyGoal: 470 },
    { email: "lara.salon.demo@caretip.de", name: "Lara Okonkwo", jobTitle: "Junior stylist", slug: "salon-lara", avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&h=150&fit=crop&crop=face", monthlyGoal: 390 },
  ],
  alpine: [
    { email: "hans.alpine.demo@caretip.de", name: "Hans Weber", jobTitle: "Concierge", slug: "alpine-hans", avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=face", monthlyGoal: 420 },
    { email: "greta.alpine.demo@caretip.de", name: "Greta Müller", jobTitle: "Housekeeping lead", slug: "alpine-greta", avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&h=150&fit=crop&crop=face", monthlyGoal: 350 },
    { email: "paul.alpine.demo@caretip.de", name: "Paul Andersson", jobTitle: "Bellhop", slug: "alpine-paul", avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face", monthlyGoal: 320 },
    { email: "sara.alpine.demo@caretip.de", name: "Sara Ilic", jobTitle: "Breakfast server", slug: "alpine-sara", avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop&crop=face", monthlyGoal: 380 },
    { email: "tim.alpine.demo@caretip.de", name: "Tim Novak", jobTitle: "Ski valet", slug: "alpine-tim", avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&h=150&fit=crop&crop=face", monthlyGoal: 300 },
  ],
  riverside: [
    { email: "clara.river.demo@caretip.de", name: "Clara Brandt", jobTitle: "Barista", slug: "river-clara", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop&crop=face", monthlyGoal: 340 },
    { email: "jonas.river.demo@caretip.de", name: "Jonas Richter", jobTitle: "Pastry chef", slug: "river-jonas", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face", monthlyGoal: 360 },
    { email: "elena.river.demo@caretip.de", name: "Elena Popov", jobTitle: "Server", slug: "river-elena", avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=face", monthlyGoal: 310 },
    { email: "mateo.river.demo@caretip.de", name: "Mateo Silva", jobTitle: "Counter staff", slug: "river-mateo", avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=face", monthlyGoal: 290 },
    { email: "freya.river.demo@caretip.de", name: "Freya Lund", jobTitle: "Shift lead", slug: "river-freya", avatar: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&h=150&fit=crop&crop=face", monthlyGoal: 400 },
  ],
};

const RETIRED_DEMO_EMAILS = [
  "platform@caretip-demo.com",
  "owner@caretip-demo.com",
  "sarah@caretip-demo.com",
  "marcus@caretip-demo.com",
  "elena@caretip-demo.com",
  "sofia.staff.demo@caretip.de",
  "emma.staff.demo@caretip.de",
  "tom.staff.demo@caretip.de",
  "lina.staff.demo@caretip.de",
  "marco.staff.demo@caretip.de",
];

const TIP_AMOUNTS = [5, 6, 7.5, 8, 8.5, 9, 10, 10.5, 11, 12, 12.5, 13, 14, 15, 16, 18, 20, 22, 25];
const FEEDBACK_COMMENTS = [
  "Exceptional service. Thank you!",
  "Made our evening special.",
  "Friendly and attentive team.",
  "Quick service on the terrace.",
  "Would definitely recommend.",
  "Perfect hospitality.",
  "Great recommendations.",
  "Lovely atmosphere.",
];
const FEEDBACK_TAGS = ["excellentService", "friendlyStaff", "fastService", "greatAtmosphere"];
const GUEST_NAMES = ["Alex", "Jordan", "Sam", "Taylor", "Chris", "Guest"];

function recentTipDate(minutesAgo: number): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() - minutesAgo);
  return d;
}

function tipDateForIndex(
  _businessKey: string,
  i: number,
  isPrimary: boolean,
  totalTips: number,
  businessTimezone = "Europe/Berlin",
): Date {
  const tz = businessTimezone;
  const now = DateTime.utc().setZone(tz);
  const nowJs = now.toJSDate();

  if (isPrimary && i < 8) {
    const recentMinutes = [42, 18, 5, 28, 12, 2, 8, 35];
    return recentTipDate(recentMinutes[i]!);
  }

  const base = isPrimary ? i - 8 : i;
  const span = isPrimary ? Math.max(1, totalTips - 8) : Math.max(1, totalTips);
  const weekBucket = Math.max(7, Math.round(span * 0.18));
  const monthBucket = Math.max(10, Math.round(span * 0.52));
  const todayDom = now.day;

  if (base < weekBucket) {
    const monday = now.startOf("day").minus({ days: (now.weekday + 6) % 7 });
    const target = monday.plus({ days: base % 7 }).set({
      hour: 11 + (base % 8),
      minute: (base * 17) % 60,
      second: 0,
      millisecond: 0,
    });
    return (target > now ? target.minus({ days: 7 }) : target).toJSDate();
  }

  if (base < weekBucket + monthBucket) {
    const monthIdx = base - weekBucket;
    const dayInMonth = (monthIdx % Math.max(todayDom, 1)) + 1;
    const target = now.startOf("month").plus({ days: dayInMonth - 1 }).set({
      hour: 10 + ((monthIdx * 3) % 9),
      minute: (monthIdx * 11) % 60,
      second: 0,
      millisecond: 0,
    });
    return target > now ? nowJs : target.toJSDate();
  }

  const yearIdx = base - weekBucket - monthBucket;
  const monthIndex = yearIdx % Math.max(1, now.month);
  const monthStart = now.startOf("year").plus({ months: monthIndex });
  const daysInMonth = monthStart.daysInMonth ?? 28;
  const day = (yearIdx % daysInMonth) + 1;
  const target = monthStart.plus({ days: day - 1 }).set({
    hour: 14,
    minute: (yearIdx * 7) % 60,
    second: 0,
    millisecond: 0,
  });
  if (target > now) {
    const fallbackMonth = Math.max(1, now.month - (yearIdx % 3));
    const fallbackStart = now.startOf("year").plus({ months: fallbackMonth - 1 });
    const fallbackDay = Math.min(day, fallbackStart.daysInMonth ?? day);
    return fallbackStart
      .plus({ days: fallbackDay - 1 })
      .set({ hour: 14, minute: (yearIdx * 7) % 60, second: 0, millisecond: 0 })
      .toJSDate();
  }
  return target.toJSDate();
}

function tipIdForBusiness(config: DemoBusinessConfig, index: number): string {
  if (config.isPrimary) {
    return `wdemotip${String(index + 1).padStart(4, "0")}`;
  }
  return `demotip-${config.key}-${String(index + 1).padStart(4, "0")}`;
}

async function purgeSupersededDemoData(prisma: PrismaClient): Promise<void> {
  await prisma.tipFeedback.deleteMany({
    where: {
      OR: [
        { transactionId: { startsWith: "wdemotip" } },
        { transactionId: { startsWith: "demotip-" } },
        { transactionId: { startsWith: "seed-tip-" } },
      ],
    },
  });
  await prisma.transaction.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "wdemotip" } },
        { id: { startsWith: "demotip-" } },
        { id: { startsWith: "seed-tip-" } },
      ],
    },
  });

  await prisma.business.deleteMany({
    where: {
      OR: [{ id: "seed-business-001" }, { slug: { in: ["the-rustic-table", "caretip-demo-venue"] } }],
    },
  });

  for (const email of RETIRED_DEMO_EMAILS) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) continue;
    await prisma.employee.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
}

async function ensureSubscription(
  prisma: PrismaClient,
  businessId: string,
  tier: BusinessSubscriptionTier,
): Promise<void> {
  const planKey = mapBusinessTierToPlanKey(tier);
  const existing = await prisma.subscription.findUnique({ where: { businessId } });
  if (existing) {
    await prisma.subscription.update({
      where: { businessId },
      data: { planKey, status: SubscriptionStatus.active, billingCycle: BillingCycle.monthly },
    });
    return;
  }
  await prisma.subscription.create({
    data: {
      businessId,
      planKey,
      status: SubscriptionStatus.active,
      billingCycle: BillingCycle.monthly,
      events: {
        create: {
          auditType: "seed_demo",
          type: "seed_demo",
          processingResult: SubscriptionEventProcessingResult.processed,
          payload: { source: "seedDemoEnvironment" },
        },
      },
    },
  });
}

async function ensureActiveEmployeeGoal(
  prisma: PrismaClient,
  employeeId: string,
  goal: { goalAmount: number; goalPeriod: "monthly"; startDate: Date },
): Promise<void> {
  const existing = await prisma.employeeGoal.findFirst({
    where: { employeeId },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (existing) {
    await prisma.employeeGoal.update({
      where: { id: existing.id },
      data: {
        goalAmount: goal.goalAmount,
        goalPeriod: goal.goalPeriod,
        startDate: goal.startDate,
        status: "active",
      },
    });
    return;
  }
  await prisma.employeeGoal.create({
    data: {
      employeeId,
      goalAmount: goal.goalAmount,
      goalPeriod: goal.goalPeriod,
      startDate: goal.startDate,
      status: "active",
    },
  });
}

async function seedStaffForBusiness(
  prisma: PrismaClient,
  passwordHash: string,
  businessId: string,
  locationId: string | null,
  staff: StaffSeed[],
): Promise<Array<{ id: string; userId: string; name: string; monthlyGoal: number }>> {
  const rows: Array<{ id: string; userId: string; name: string; monthlyGoal: number }> = [];

  for (const s of staff) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: {
        role: "EMPLOYEE",
        isActive: true,
        isPlatformAdmin: false,
        emailVerified: true,
        hasCompletedOnboarding: s.isDemoLogin ? true : undefined,
        passwordHash,
      },
      create: {
        email: s.email,
        passwordHash,
        role: "EMPLOYEE",
        isActive: true,
        isPlatformAdmin: false,
        emailVerified: true,
        hasCompletedOnboarding: s.isDemoLogin ?? false,
      },
    });

    const emp = await prisma.employee.upsert({
      where: { userId: user.id },
      update: {
        name: s.name,
        jobTitle: s.jobTitle,
        slug: s.slug,
        avatar: s.avatar,
        businessId,
        locationId,
        isActive: true,
        activationStatus: "active",
        monthlyGoal: s.monthlyGoal,
        isDeleted: false,
      },
      create: {
        name: s.name,
        jobTitle: s.jobTitle,
        slug: s.slug,
        avatar: s.avatar,
        businessId,
        userId: user.id,
        locationId,
        isActive: true,
        activationStatus: "active",
        monthlyGoal: s.monthlyGoal,
      },
    });

    rows.push({ id: emp.id, userId: user.id, name: s.name, monthlyGoal: s.monthlyGoal });
  }

  return rows;
}

async function seedTipsAndFeedback(
  prisma: PrismaClient,
  config: DemoBusinessConfig,
  businessId: string,
  employees: Array<{ id: string }>,
  locationIds: string[],
  tableIds: string[],
  primaryEmployeeId?: string,
): Promise<{ tipCount: number; feedbackCount: number }> {
  let tipCount = 0;
  for (let i = 0; i < config.tipCount; i++) {
    const id = tipIdForBusiness(config, i);
    const emp =
      config.isPrimary && i % 7 === 0 && primaryEmployeeId
        ? { id: primaryEmployeeId }
        : (employees[i % employees.length] ?? employees[0]!);
    const locIdx = i % locationIds.length;
    const amount = TIP_AMOUNTS[i % TIP_AMOUNTS.length]!;
    await prisma.transaction.upsert({
      where: { id },
      update: {
        amount,
        status: "success",
        payoutStatus: "pending",
        employeeId: emp.id,
        businessId,
        locationId: locationIds[locIdx] ?? null,
        tableId: tableIds[locIdx] ?? null,
        createdAt: tipDateForIndex(config.key, i, Boolean(config.isPrimary), config.tipCount),
      },
      create: {
        id,
        amount,
        status: "success",
        payoutStatus: "pending",
        employeeId: emp.id,
        businessId,
        locationId: locationIds[locIdx] ?? null,
        tableId: tableIds[locIdx] ?? null,
        createdAt: tipDateForIndex(config.key, i, Boolean(config.isPrimary), config.tipCount),
      },
    });
    tipCount++;
  }

  let feedbackCount = 0;
  for (let i = 0; i < config.feedbackCount; i++) {
    const tipIndex = config.isPrimary ? i * 4 : i * 3;
    const txId = tipIdForBusiness(config, tipIndex);
    const emp = employees[i % employees.length];
    if (!emp) continue;
    const locIdx = i % Math.max(locationIds.length, 1);
    const rating = 4 + (i % 2);
    await prisma.tipFeedback.upsert({
      where: { transactionId: txId },
      update: {
        businessId,
        employeeId: emp.id,
        locationId: locationIds[locIdx] ?? null,
        tableId: tableIds[locIdx] ?? null,
        rating,
        comment: FEEDBACK_COMMENTS[i % FEEDBACK_COMMENTS.length] ?? null,
        tags: [FEEDBACK_TAGS[i % FEEDBACK_TAGS.length]!],
        customerName: GUEST_NAMES[i % GUEST_NAMES.length] ?? null,
        createdAt: tipDateForIndex(config.key, tipIndex, Boolean(config.isPrimary), config.tipCount),
      },
      create: {
        transactionId: txId,
        businessId,
        employeeId: emp.id,
        locationId: locationIds[locIdx] ?? null,
        tableId: tableIds[locIdx] ?? null,
        rating,
        comment: FEEDBACK_COMMENTS[i % FEEDBACK_COMMENTS.length] ?? null,
        tags: [FEEDBACK_TAGS[i % FEEDBACK_TAGS.length]!],
        customerName: GUEST_NAMES[i % GUEST_NAMES.length] ?? null,
        createdAt: tipDateForIndex(config.key, tipIndex, Boolean(config.isPrimary), config.tipCount),
      },
    });
    feedbackCount++;
  }

  return { tipCount, feedbackCount };
}

async function seedDemoInboxNotifications(
  prisma: PrismaClient,
  users: { managerId: string; employeeUserId: string | null },
): Promise<void> {
  const rows = [
    {
      userId: users.managerId,
      type: "demo_welcome",
      title: "Welcome to CareTip",
      message: "Your demo venue is live. Review tips, staff, and goals from the dashboard.",
      dedupeKey: "walkthrough:manager:welcome",
      metadata: {},
      channels: ["in_app"],
    },
    {
      userId: users.managerId,
      type: "demo_tips",
      title: "Tips are flowing in",
      message: "Seeded demo tips are available across week, month, and year views.",
      dedupeKey: "walkthrough:manager:tips",
      metadata: {},
      channels: ["in_app"],
    },
  ];
  if (users.employeeUserId) {
    rows.push({
      userId: users.employeeUserId,
      type: "demo_welcome",
      title: "Your tip dashboard is ready",
      message: "Track earnings, goals, and recent tips from your employee dashboard.",
      dedupeKey: "walkthrough:employee:welcome",
      metadata: {},
      channels: ["in_app"],
    });
  }
  for (const row of rows) {
    await prisma.notification.upsert({
      where: { userId_dedupeKey: { userId: row.userId, dedupeKey: row.dedupeKey } },
      update: {
        title: row.title,
        message: row.message,
        metadata: row.metadata,
        channels: row.channels,
        readAt: null,
      },
      create: {
        userId: row.userId,
        type: row.type,
        title: row.title,
        message: row.message,
        metadata: row.metadata,
        channels: row.channels,
        dedupeKey: row.dedupeKey,
      },
    });
  }
}

export async function seedDemoEnvironment(prisma: PrismaClient): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await purgeSupersededDemoData(prisma);

  const adminUser = await prisma.user.upsert({
    where: { email: DEMO_ADMIN_EMAIL },
    update: {
      role: "SUPER_ADMIN",
      isPlatformAdmin: true,
      isActive: true,
      emailVerified: true,
      hasCompletedOnboarding: true,
      passwordHash,
    },
    create: {
      email: DEMO_ADMIN_EMAIL,
      passwordHash,
      role: "SUPER_ADMIN",
      isPlatformAdmin: true,
      isActive: true,
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });

  let totalTips = 0;
  let totalFeedback = 0;
  let totalEmployees = 0;
  let primaryManagerId: string | null = null;
  let primaryEmployeeUserId: string | null = null;
  const goalMonthStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 12, 0, 0, 0),
  );

  for (const config of DEMO_BUSINESSES) {
    const isManagerPrimary = config.managerEmail === DEMO_MANAGER_EMAIL;
    const manager = await prisma.user.upsert({
      where: { email: config.managerEmail },
      update: {
        role: "MANAGER",
        isActive: true,
        isPlatformAdmin: false,
        emailVerified: true,
        hasCompletedOnboarding: config.onboardingVerificationStatus === "approved",
        passwordHash,
      },
      create: {
        email: config.managerEmail,
        passwordHash,
        role: "MANAGER",
        isActive: true,
        isPlatformAdmin: false,
        emailVerified: true,
        hasCompletedOnboarding: config.onboardingVerificationStatus === "approved",
      },
    });

    if (isManagerPrimary) primaryManagerId = manager.id;

    let slug = config.slug;
    const slugTaken = await prisma.business.findFirst({
      where: { slug, NOT: { id: config.id } },
      select: { id: true },
    });
    if (slugTaken) slug = `${config.slug}-demo`;

    const submittedAt =
      config.onboardingVerificationStatus === "submitted" ||
      config.onboardingVerificationStatus === "approved"
        ? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
        : null;

    const businessData = {
      name: config.name,
      slug,
      inviteCode: config.inviteCode,
      userId: manager.id,
      verificationStatus: config.verificationStatus,
      onboardingVerificationStatus: config.onboardingVerificationStatus,
      kycVerificationStatus: config.kycVerificationStatus,
      onboardingSubmittedAt: submittedAt,
      businessType: config.businessType,
      location: config.location,
      registeredAddress: config.registeredAddress,
      contactEmail: config.managerEmail,
      legalContactName: `${config.name} Manager`,
      subscriptionTier: config.subscriptionTier,
    };

    const existingBusiness = await prisma.business.findFirst({
      where: { OR: [{ id: config.id }, { userId: manager.id }] },
      select: { id: true },
    });

    const business = existingBusiness
      ? await prisma.business.update({
          where: { id: existingBusiness.id },
          data: businessData,
        })
      : await prisma.business.create({
          data: { id: config.id, ...businessData },
        });

    await ensureSubscription(prisma, business.id, config.subscriptionTier);

    const locationIds: string[] = [];
    const tableIds: string[] = [];

    if (config.isPrimary) {
      const locMain = await prisma.location.upsert({
        where: { id: PRIMARY_LOCATION_MAIN_ID },
        update: { name: "Main dining room", businessId: business.id },
        create: {
          id: PRIMARY_LOCATION_MAIN_ID,
          name: "Main dining room",
          description: "Demo: indoor seating.",
          businessId: business.id,
        },
      });
      const locGarden = await prisma.location.upsert({
        where: { id: PRIMARY_LOCATION_GARDEN_ID },
        update: { name: "Terrace", businessId: business.id },
        create: {
          id: PRIMARY_LOCATION_GARDEN_ID,
          name: "Terrace",
          description: "Demo: outdoor terrace.",
          businessId: business.id,
        },
      });
      locationIds.push(locMain.id, locGarden.id);

      await prisma.table.upsert({
        where: { qrSlug: PRIMARY_TABLE_QR_MAIN },
        update: { name: "Table 12 Window", locationId: locMain.id },
        create: { name: "Table 12 Window", qrSlug: PRIMARY_TABLE_QR_MAIN, locationId: locMain.id },
      });
      await prisma.table.upsert({
        where: { qrSlug: PRIMARY_TABLE_QR_GARDEN },
        update: { name: "Table 4 Patio", locationId: locGarden.id },
        create: { name: "Table 4 Patio", qrSlug: PRIMARY_TABLE_QR_GARDEN, locationId: locGarden.id },
      });
      const tableMain = await prisma.table.findUniqueOrThrow({ where: { qrSlug: PRIMARY_TABLE_QR_MAIN } });
      const tableGarden = await prisma.table.findUniqueOrThrow({ where: { qrSlug: PRIMARY_TABLE_QR_GARDEN } });
      tableIds.push(tableMain.id, tableGarden.id);
    } else {
      const loc = await prisma.location.upsert({
        where: { id: `cldemo_loc_${config.key}` },
        update: { name: "Main floor", businessId: business.id },
        create: {
          id: `cldemo_loc_${config.key}`,
          name: "Main floor",
          description: `Demo location for ${config.name}.`,
          businessId: business.id,
        },
      });
      locationIds.push(loc.id);
      const table = await prisma.table.upsert({
        where: { qrSlug: `demo-${config.key}-table-01` },
        update: { name: "Table 1", locationId: loc.id },
        create: { name: "Table 1", qrSlug: `demo-${config.key}-table-01`, locationId: loc.id },
      });
      tableIds.push(table.id);
    }

    const staffRoster = config.isPrimary
      ? PRIMARY_STAFF
      : (SECONDARY_STAFF_ROSTERS[config.key] ?? []).slice(0, EMPLOYEES_PER_BUSINESS);

    const employeeRows = await seedStaffForBusiness(
      prisma,
      passwordHash,
      business.id,
      locationIds[0] ?? null,
      staffRoster,
    );
    totalEmployees += employeeRows.length;

    const demoPrimaryId =
      config.isPrimary
        ? employeeRows.find((_, idx) => PRIMARY_STAFF[idx]?.isDemoLogin)?.id
        : undefined;

    if (config.isPrimary && demoPrimaryId) {
      const demoUser = await prisma.user.findUnique({
        where: { email: DEMO_EMPLOYEE_EMAIL },
        select: { id: true },
      });
      primaryEmployeeUserId = demoUser?.id ?? null;
    }

    for (const [i, row] of employeeRows.entries()) {
      if (tableIds.length === 0) continue;
      const tableId = tableIds[i % tableIds.length]!;
      await prisma.employeeTableAssignment.upsert({
        where: { employeeId_tableId: { employeeId: row.id, tableId } },
        update: { employeeName: row.name },
        create: { employeeId: row.id, tableId, employeeName: row.name },
      });
    }

    const counts = await seedTipsAndFeedback(
      prisma,
      config,
      business.id,
      employeeRows,
      locationIds,
      tableIds,
      demoPrimaryId,
    );
    totalTips += counts.tipCount;
    totalFeedback += counts.feedbackCount;

    for (const row of employeeRows.slice(0, 3)) {
      await ensureActiveEmployeeGoal(prisma, row.id, {
        goalAmount: row.monthlyGoal,
        goalPeriod: "monthly",
        startDate: goalMonthStart,
      });
    }

    if (!config.isPrimary && config.tipCount > 0) {
      await prisma.notification.upsert({
        where: {
          userId_dedupeKey: {
            userId: manager.id,
            dedupeKey: `demo:manager:${config.key}:welcome`,
          },
        },
        update: {
          title: `${config.name} is ready`,
          message: "Demo tips and staff are seeded for this venue.",
          metadata: { businessId: business.id },
          channels: ["in_app"],
          readAt: null,
        },
        create: {
          userId: manager.id,
          type: "demo_welcome",
          title: `${config.name} is ready`,
          message: "Demo tips and staff are seeded for this venue.",
          metadata: { businessId: business.id },
          channels: ["in_app"],
          dedupeKey: `demo:manager:${config.key}:welcome`,
        },
      });
    }
  }

  if (primaryManagerId) {
    await seedDemoInboxNotifications(prisma, {
      managerId: primaryManagerId,
      employeeUserId: primaryEmployeeUserId,
    });
  }

  await seedDemoActivityCenter(prisma);

  await prisma.auditLog.deleteMany({
    where: { userId: adminUser.id, action: { startsWith: "walkthrough_demo." } },
  });
  await prisma.auditLog.createMany({
    data: [
      {
        userId: adminUser.id,
        action: "walkthrough_demo.seed",
        metadata: "Demo environment: 5 businesses, 5 employees each.",
      },
      {
        userId: adminUser.id,
        action: "walkthrough_demo.business_directory",
        metadata: DEMO_BUSINESSES.map((b) => `${b.name} (${b.onboardingVerificationStatus})`).join("; "),
      },
      {
        userId: adminUser.id,
        action: "walkthrough_demo.staff_overview",
        metadata: "Primary venue: demo@ + employee@; 4 additional demo businesses for platform admin.",
      },
    ],
  });

  const teamSeed = await seedPlatformAdminTeam(prisma);

  console.log("");
  console.log("── CareTip demo environment ──");
  console.log(`  Businesses:  ${DEMO_BUSINESSES.length} (admin overview)`);
  console.log(`  Employees:   ${totalEmployees} (${EMPLOYEES_PER_BUSINESS} per business)`);
  console.log(`  Tips:        ${totalTips} successful transactions`);
  console.log(`  Feedback:    ${totalFeedback} guest reviews`);
  console.log(`  Manager:     ${DEMO_MANAGER_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Employee:    ${DEMO_EMPLOYEE_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Admin:       ${DEMO_ADMIN_EMAIL} / ${DEMO_PASSWORD}`);
  console.log("  Team admins: albertina@caretip.de, fanny@caretip.de (see README for temp passwords)");
  if (teamSeed.created.length > 0) {
    console.log(`  Team created: ${teamSeed.created.join(", ")}`);
  }
  console.log("  Other managers: harbor.demo@, salon.demo@, alpine.demo@, riverside.demo@ — same password");
}

/** @deprecated Alias for seedDemoEnvironment — kept for existing imports. */
export async function seedWalkthroughDemo(prisma: PrismaClient): Promise<void> {
  return seedDemoEnvironment(prisma);
}
