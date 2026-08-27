import type { FaqItem } from "@/constants/infoContent";

export const FAQ_ITEM_IDS = [
  "whatIsCaretip",
  "howTipsWork",
  "isSecure",
  "inviteCode",
  "qrBranded",
  "forgotPassword",
  "support",
] as const;

export type FaqItemId = (typeof FAQ_ITEM_IDS)[number];

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export function getLocalizedFaqItems(t: TranslateFn): FaqItem[] {
  return FAQ_ITEM_IDS.map((id) => ({
    id,
    question: t(`info.faq.${id}.q`),
    answer: t(`info.faq.${id}.a`),
  }));
}

export const CONTACT_CHANNEL_IDS = ["whatsapp", "email", "inquiry", "ticket", "phone"] as const;

export type ContactChannelId = (typeof CONTACT_CHANNEL_IDS)[number];

export function getContactChannelTitle(t: TranslateFn, id: ContactChannelId): string {
  return t(`info.contact.${id}Title`);
}

export function getContactChannelSubtitle(t: TranslateFn, id: ContactChannelId): string {
  return t(`info.contact.${id}Subtitle`);
}

export function getBusinessHoursRows(t: TranslateFn): Array<{ day: string; hours: string }> {
  return [
    { day: t("info.contact.hoursWeekdays"), hours: t("info.contact.hoursWeekdaysTime") },
    { day: t("info.contact.hoursSaturday"), hours: t("info.contact.hoursSaturdayTime") },
    { day: t("info.contact.hoursSunday"), hours: t("info.contact.hoursSundayTime") },
  ];
}
