/**
 * Payload from GET /api/employees/me/export — keep aligned with backend exportEmployeeData.
 * Used only to render a human-readable PDF on mobile; web still downloads JSON.
 */

export type EmployeeDataExportTip = {
  amount: number;
  createdAt: string;
};

export type EmployeeDataExportProfile = {
  name: string | null;
  email: string | null;
  jobTitle: string | null;
  bio: string | null;
  monthlyGoal: number | null;
  accountCreatedAt: string | null;
};

export type EmployeeDataExportPayload = {
  exportedAt: string;
  profile: EmployeeDataExportProfile;
  tips: EmployeeDataExportTip[];
};

export function parseEmployeeDataExport(data: unknown): EmployeeDataExportPayload {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid data export payload.");
  }
  const root = data as Record<string, unknown>;
  const profileRaw =
    root.profile && typeof root.profile === "object"
      ? (root.profile as Record<string, unknown>)
      : {};
  const tipsRaw = Array.isArray(root.tips) ? root.tips : [];

  const tips: EmployeeDataExportTip[] = tipsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const tip = item as Record<string, unknown>;
      const amount = typeof tip.amount === "number" ? tip.amount : Number(tip.amount);
      const createdAt = typeof tip.createdAt === "string" ? tip.createdAt : "";
      if (!Number.isFinite(amount) || !createdAt) return null;
      return { amount, createdAt };
    })
    .filter((tip): tip is EmployeeDataExportTip => tip != null);

  return {
    exportedAt:
      typeof root.exportedAt === "string" ? root.exportedAt : new Date().toISOString(),
    profile: {
      name: stringOrNull(profileRaw.name),
      email: stringOrNull(profileRaw.email),
      jobTitle: stringOrNull(profileRaw.jobTitle),
      bio: stringOrNull(profileRaw.bio),
      monthlyGoal:
        profileRaw.monthlyGoal == null
          ? null
          : Number.isFinite(Number(profileRaw.monthlyGoal))
            ? Number(profileRaw.monthlyGoal)
            : null,
      accountCreatedAt: stringOrNull(profileRaw.accountCreatedAt),
    },
    tips,
  };
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
