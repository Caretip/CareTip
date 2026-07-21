import type {
  BusinessActivityFeedItem,
  TipActivityRow,
  TableDTO,
} from "@/app/lib/api";
import { peekAllBusinessAnalyticsBundles } from "@/app/lib/businessAnalytics";
import { getBusinessActivitySearchSnapshot } from "@/app/lib/businessActivitySearchSnapshot";
import {
  peekPageSessionCache,
  peekPageSessionCacheByPrefix,
} from "@/app/lib/pageSessionCache";
import { formatEur } from "@/app/lib/formatEur";

export type BusinessSearchCategory =
  | "employees"
  | "qrTables"
  | "recentTips"
  | "recentActivity"
  | "payouts";

export type BusinessSearchHit = {
  id: string;
  category: BusinessSearchCategory;
  title: string;
  subtitle: string;
  /** Optional i18n keys; when set, UI prefers these over title/subtitle. */
  titleKey?: string;
  subtitleKey?: string;
  href: string;
  /** Fields used for matching / highlight. */
  haystack: string;
};

type StaffCacheRow = {
  id: string;
  name: string;
  role?: string;
  email?: string;
  slug?: string | null;
};

type TablesBundle = { tables: TableDTO[]; locations?: Array<{ id: string; name: string }> };

type TipsActivityCache = {
  items: TipActivityRow[];
};

const PAYOUT_SHORTCUTS: Array<Omit<BusinessSearchHit, "haystack"> & { keywords: string }> = [
  {
    id: "payout:subscription",
    category: "payouts",
    title: "Subscription & billing",
    subtitle: "Plan, payouts, and subscription status",
    titleKey: "business.globalSearch.payoutShortcuts.subscriptionTitle",
    subtitleKey: "business.globalSearch.payoutShortcuts.subscriptionSubtitle",
    href: "/dashboard/billing/subscription",
    keywords:
      "payout payouts billing subscription plan stripe invoice invoices payment abo abrechnung auszahlung",
  },
  {
    id: "payout:invoices",
    category: "payouts",
    title: "Invoices",
    subtitle: "Billing history and invoices",
    titleKey: "business.globalSearch.payoutShortcuts.invoicesTitle",
    subtitleKey: "business.globalSearch.payoutShortcuts.invoicesSubtitle",
    href: "/dashboard/billing/invoices",
    keywords: "payout invoice invoices billing receipt rechnung rechnungen",
  },
  {
    id: "payout:history",
    category: "payouts",
    title: "Payment history",
    subtitle: "Past billing and payment events",
    titleKey: "business.globalSearch.payoutShortcuts.historyTitle",
    subtitleKey: "business.globalSearch.payoutShortcuts.historySubtitle",
    href: "/dashboard/billing/history",
    keywords: "payout payment history billing zahlungsverlauf historie",
  },
];

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function matchesQuery(haystack: string, query: string): boolean {
  const q = normalize(query);
  if (!q) return false;
  return normalize(haystack).includes(q);
}

function activityTitle(item: BusinessActivityFeedItem): string {
  const title = typeof item.params?.title === "string" ? item.params.title : null;
  const message = typeof item.params?.message === "string" ? item.params.message : null;
  const employee =
    typeof item.params?.employeeName === "string"
      ? item.params.employeeName
      : typeof item.params?.staffName === "string"
        ? item.params.staffName
        : null;
  if (title) return title;
  if (message) return message;
  if (employee) return `${item.type.replace(/_/g, " ")} · ${employee}`;
  return item.titleKey || item.type.replace(/_/g, " ");
}

function activitySubtitle(item: BusinessActivityFeedItem): string {
  const parts = [item.source, item.type.replace(/_/g, " ")];
  if (item.occurredAt) {
    try {
      parts.push(new Date(item.occurredAt).toLocaleString());
    } catch {
      /* ignore */
    }
  }
  return parts.filter(Boolean).join(" · ");
}

/** Collect searchable documents from already-loaded client caches (no network). */
export function collectBusinessSearchCorpus(businessId?: string | null): BusinessSearchHit[] {
  const hits: BusinessSearchHit[] = [];
  const seen = new Set<string>();

  const push = (hit: BusinessSearchHit) => {
    if (seen.has(hit.id)) return;
    seen.add(hit.id);
    hits.push(hit);
  };

  const bundles = peekAllBusinessAnalyticsBundles();
  for (const bundle of bundles) {
    for (const emp of bundle.periodStats?.employees ?? []) {
      push({
        id: `employee:${emp.id}`,
        category: "employees",
        title: emp.name,
        subtitle: [emp.jobTitle, emp.email].filter(Boolean).join(" · ") || "Team member",
        href: `/dashboard/team/employees`,
        haystack: [emp.name, emp.jobTitle, emp.email, emp.slug].filter(Boolean).join(" "),
      });
    }
    for (const tip of bundle.recentTips ?? []) {
      const amount = formatEur(Number(tip.amount) || 0);
      push({
        id: `tip:${tip.id}`,
        category: "recentTips",
        title: `${amount} tip`,
        subtitle: [tip.staffName, tip.tableName || tip.locationName, tip.status]
          .filter(Boolean)
          .join(" · "),
        href: `/dashboard/tips/transactions`,
        haystack: [tip.id, tip.staffName, tip.tableName, tip.locationName, tip.status, amount]
          .filter(Boolean)
          .join(" "),
      });
    }
  }

  if (businessId) {
    const staff = peekPageSessionCache<StaffCacheRow[]>(`business:staff:${businessId}`);
    for (const emp of staff ?? []) {
      push({
        id: `employee:${emp.id}`,
        category: "employees",
        title: emp.name,
        subtitle: [emp.role, emp.email].filter(Boolean).join(" · ") || "Team member",
        href: `/dashboard/team/employees`,
        haystack: [emp.name, emp.role, emp.email, emp.slug].filter(Boolean).join(" "),
      });
    }
  }

  const tablesBundle = peekPageSessionCache<TablesBundle>("business:tables-bundle");
  for (const table of tablesBundle?.tables ?? []) {
    push({
      id: `table:${table.id}`,
      category: "qrTables",
      title: table.name,
      subtitle: [table.location?.name, table.qrSlug].filter(Boolean).join(" · ") || "QR table",
      href: `/dashboard/qr-studio/tables`,
      haystack: [table.name, table.location?.name, table.qrSlug, table.id].filter(Boolean).join(" "),
    });
  }

  const tipCaches = peekPageSessionCacheByPrefix<TipsActivityCache>("tips-activity:");
  for (const entry of tipCaches) {
    for (const tip of entry.value?.items ?? []) {
      const amount = formatEur(Number(tip.amount) || 0);
      push({
        id: `tip:${tip.id}`,
        category: "recentTips",
        title: `${amount} tip`,
        subtitle: [tip.staffName, tip.tableName || tip.locationName, tip.status]
          .filter(Boolean)
          .join(" · "),
        href: `/dashboard/tips/transactions`,
        haystack: [tip.id, tip.staffName, tip.tableName, tip.locationName, tip.status, amount]
          .filter(Boolean)
          .join(" "),
      });
    }
  }

  for (const item of getBusinessActivitySearchSnapshot()) {
    const title = activityTitle(item);
    const subtitle = activitySubtitle(item);
    push({
      id: `activity:${item.id}`,
      category: "recentActivity",
      title,
      subtitle,
      href: "/dashboard/tips/live",
      haystack: [title, subtitle, item.type, item.source, item.titleKey].filter(Boolean).join(" "),
    });
  }

  for (const payout of PAYOUT_SHORTCUTS) {
    push({
      id: payout.id,
      category: "payouts",
      title: payout.title,
      subtitle: payout.subtitle,
      titleKey: payout.titleKey,
      subtitleKey: payout.subtitleKey,
      href: payout.href,
      haystack: `${payout.title} ${payout.subtitle} ${payout.keywords}`,
    });
  }

  return hits;
}

export function filterBusinessSearchHits(
  corpus: BusinessSearchHit[],
  query: string,
  limitPerCategory = 5,
): BusinessSearchHit[] {
  const q = normalize(query);
  if (!q) return [];

  const grouped = new Map<BusinessSearchCategory, BusinessSearchHit[]>();
  for (const hit of corpus) {
    if (!matchesQuery(hit.haystack, q)) continue;
    const list = grouped.get(hit.category) ?? [];
    if (list.length >= limitPerCategory) continue;
    list.push(hit);
    grouped.set(hit.category, list);
  }

  const order: BusinessSearchCategory[] = [
    "employees",
    "qrTables",
    "recentTips",
    "recentActivity",
    "payouts",
  ];
  return order.flatMap((cat) => grouped.get(cat) ?? []);
}

/** Split text into plain / match segments for highlighted rendering. */
export function highlightMatchSegments(
  text: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  const q = query.trim();
  if (!q || !text) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx < 0) return [{ text, match: false }];
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);
  const parts: Array<{ text: string; match: boolean }> = [];
  if (before) parts.push({ text: before, match: false });
  parts.push({ text: match, match: true });
  if (after) parts.push(...highlightMatchSegments(after, query));
  return parts;
}
