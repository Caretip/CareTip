/**
 * Class S setup-prompt intelligence — server-backed lifecycle.
 * Keys are derived from the authenticated user/business; clients never supply ownership ids.
 */
import type { SetupNotificationStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Allowlisted setup kinds (no inbox rows). */
export const SETUP_PROMPT_KINDS = [
  "stripe_connect",
  "missing_employee_qr",
  "onboarding_verification",
  "profile_photo",
] as const;

export type SetupPromptKind = (typeof SETUP_PROMPT_KINDS)[number];

export function isSetupPromptKind(value: string): value is SetupPromptKind {
  return (SETUP_PROMPT_KINDS as readonly string[]).includes(value);
}

export type SetupPromptEvaluateItem = {
  kind: SetupPromptKind;
  conditionActive: boolean;
  /** Fingerprint of the unresolved condition (e.g. not_ready, pending, rejected). */
  conditionVersion: string;
};

export type SetupPromptVisibility = {
  kind: SetupPromptKind;
  show: boolean;
  status: SetupNotificationStatus | "none";
  remindAt: string | null;
};

function buildKey(
  kind: SetupPromptKind,
  ctx: { userId: string; businessId: string | null },
): string {
  switch (kind) {
    case "stripe_connect":
    case "missing_employee_qr":
    case "onboarding_verification":
      if (!ctx.businessId) throw new Error("Business context required for this setup prompt");
      return `setup:${kind}:business:${ctx.businessId}`;
    case "profile_photo":
      return `setup:profile_photo:user:${ctx.userId}`;
  }
}

/** Snooze duration — verification is stricter (shorter) than Stripe/QR. */
export function snoozeMsFor(kind: SetupPromptKind, conditionVersion: string): number {
  if (kind === "onboarding_verification") {
    if (conditionVersion === "rejected") return 2 * DAY_MS;
    return 1 * DAY_MS; // pending (and any other verification state)
  }
  return 7 * DAY_MS;
}

function normalizeVersion(raw: string): string {
  const v = raw.trim().slice(0, 64);
  return v || "default";
}

/**
 * Evaluate whether a setup prompt should be shown for the authenticated user.
 * Login/remount are not lifecycle events — only condition + persisted dismiss/snooze matter.
 */
export async function evaluateSetupPrompts(
  userId: string,
  businessId: string | null,
  items: SetupPromptEvaluateItem[],
): Promise<SetupPromptVisibility[]> {
  const now = new Date();
  const results: SetupPromptVisibility[] = [];

  type Prepared = {
    item: SetupPromptEvaluateItem;
    key: string;
    conditionVersion: string;
  };
  const prepared: Prepared[] = [];
  for (const item of items) {
    const conditionVersion = normalizeVersion(item.conditionVersion);
    try {
      const key = buildKey(item.kind, { userId, businessId });
      prepared.push({ item, key, conditionVersion });
    } catch {
      results.push({ kind: item.kind, show: false, status: "none", remindAt: null });
    }
  }

  const existingRows =
    prepared.length === 0
      ? []
      : await prisma.setupNotificationState.findMany({
          where: {
            userId,
            notificationKey: { in: prepared.map((p) => p.key) },
          },
        });
  const existingByKey = new Map(existingRows.map((r) => [r.notificationKey, r] as const));

  for (const { item, key, conditionVersion } of prepared) {
    const existing = existingByKey.get(key) ?? null;

    if (!item.conditionActive) {
      if (existing && existing.status !== "resolved") {
        await prisma.setupNotificationState.update({
          where: { id: existing.id },
          data: {
            status: "resolved",
            resolvedAt: now,
            conditionVersion,
            remindAt: null,
          },
        });
      }
      results.push({ kind: item.kind, show: false, status: "resolved", remindAt: null });
      continue;
    }

    // Condition active
    if (!existing) {
      const created = await prisma.setupNotificationState.create({
        data: {
          userId,
          notificationKey: key,
          businessId: businessId ?? undefined,
          status: "active",
          conditionVersion,
        },
      });
      existingByKey.set(key, created);
      results.push({ kind: item.kind, show: true, status: "active", remindAt: null });
      continue;
    }

    // New occurrence of the problem (different fingerprint) → new ACTIVE cycle
    if (existing.conditionVersion !== conditionVersion) {
      const updated = await prisma.setupNotificationState.update({
        where: { id: existing.id },
        data: {
          status: "active",
          conditionVersion,
          dismissedAt: null,
          remindAt: null,
          actionedAt: null,
          resolvedAt: null,
          businessId: businessId ?? existing.businessId,
        },
      });
      existingByKey.set(key, updated);
      results.push({
        kind: item.kind,
        show: true,
        status: updated.status,
        remindAt: null,
      });
      continue;
    }

    if (existing.status === "resolved") {
      // Same condition still active after resolve (shouldn't stick) → reopen
      await prisma.setupNotificationState.update({
        where: { id: existing.id },
        data: { status: "active", resolvedAt: null },
      });
      results.push({ kind: item.kind, show: true, status: "active", remindAt: null });
      continue;
    }

    if (
      (existing.status === "dismissed" || existing.status === "actioned") &&
      existing.remindAt &&
      existing.remindAt.getTime() > now.getTime()
    ) {
      results.push({
        kind: item.kind,
        show: false,
        status: existing.status,
        remindAt: existing.remindAt.toISOString(),
      });
      continue;
    }

    // Snooze expired or still active → show
    results.push({
      kind: item.kind,
      show: true,
      status: existing.status === "dismissed" || existing.status === "actioned" ? "active" : existing.status,
      remindAt: existing.remindAt?.toISOString() ?? null,
    });
  }

  return results;
}

export async function dismissSetupPrompt(
  userId: string,
  businessId: string | null,
  kind: SetupPromptKind,
  conditionVersion: string,
): Promise<SetupPromptVisibility> {
  const version = normalizeVersion(conditionVersion);
  const key = buildKey(kind, { userId, businessId });
  const now = new Date();
  const remindAt = new Date(now.getTime() + snoozeMsFor(kind, version));

  const row = await prisma.setupNotificationState.upsert({
    where: { userId_notificationKey: { userId, notificationKey: key } },
    create: {
      userId,
      notificationKey: key,
      businessId: businessId ?? undefined,
      status: "dismissed",
      conditionVersion: version,
      dismissedAt: now,
      remindAt,
    },
    update: {
      status: "dismissed",
      conditionVersion: version,
      dismissedAt: now,
      remindAt,
      resolvedAt: null,
      businessId: businessId ?? undefined,
    },
  });

  return {
    kind,
    show: false,
    status: row.status,
    remindAt: row.remindAt?.toISOString() ?? null,
  };
}

export async function actionSetupPrompt(
  userId: string,
  businessId: string | null,
  kind: SetupPromptKind,
  conditionVersion: string,
): Promise<SetupPromptVisibility> {
  const version = normalizeVersion(conditionVersion);
  const key = buildKey(kind, { userId, businessId });
  const now = new Date();
  // Actioning also applies the same snooze so the prompt does not bounce back on remount.
  const remindAt = new Date(now.getTime() + snoozeMsFor(kind, version));

  const row = await prisma.setupNotificationState.upsert({
    where: { userId_notificationKey: { userId, notificationKey: key } },
    create: {
      userId,
      notificationKey: key,
      businessId: businessId ?? undefined,
      status: "actioned",
      conditionVersion: version,
      actionedAt: now,
      dismissedAt: now,
      remindAt,
    },
    update: {
      status: "actioned",
      conditionVersion: version,
      actionedAt: now,
      dismissedAt: now,
      remindAt,
      resolvedAt: null,
      businessId: businessId ?? undefined,
    },
  });

  return {
    kind,
    show: false,
    status: row.status,
    remindAt: row.remindAt?.toISOString() ?? null,
  };
}

/** Test/helper: read raw state (user-scoped). */
export async function getSetupPromptState(userId: string, notificationKey: string) {
  return prisma.setupNotificationState.findUnique({
    where: { userId_notificationKey: { userId, notificationKey } },
  });
}

export function setupKeyForTests(
  kind: SetupPromptKind,
  ctx: { userId: string; businessId: string | null },
): string {
  return buildKey(kind, ctx);
}
