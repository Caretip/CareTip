import type { TFunction } from "i18next";

export type StaticFaqItem = {
  question: string;
  answer: string;
};

type RawFaqItem = {
  q: string;
  a?: string;
  aLead?: string;
  aBody?: string;
};

export function staticFaqAnswerText(item: RawFaqItem): string {
  if (item.a?.trim()) return item.a.trim();
  if (item.aLead && item.aBody) return `${item.aLead} ${item.aBody}`.trim();
  return "";
}

/** Public FAQ copy from i18n — shared by JSON-LD and build-time static HTML. */
export function parseStaticFaqItems(t: TFunction): StaticFaqItem[] {
  const raw = t("staticPages.faq.items", { returnObjects: true });
  if (!Array.isArray(raw)) return [];
  const items: StaticFaqItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("q" in entry)) continue;
    const item = entry as RawFaqItem;
    if (typeof item.q !== "string" || !item.q.trim()) continue;
    const answer = staticFaqAnswerText(item);
    if (!answer) continue;
    items.push({ question: item.q.trim(), answer });
  }
  return items;
}
