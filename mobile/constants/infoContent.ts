import {
  CARETIP_INFO_MAILTO,
  CARETIP_SUPPORT_MAILTO,
  CARETIP_SUPPORT_TICKET_MAILTO,
} from "./caretipContactEmails";

export type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

/** Non-translatable contact channel metadata (icons + links). */
export const CONTACT_CHANNEL_DEFS = [
  {
    id: "whatsapp" as const,
    icon: "logo-whatsapp" as const,
    href: "https://wa.me/4915200000000",
  },
  {
    id: "email" as const,
    icon: "mail-outline" as const,
    href: CARETIP_SUPPORT_MAILTO,
  },
  {
    id: "inquiry" as const,
    icon: "chatbubble-ellipses-outline" as const,
    href: CARETIP_INFO_MAILTO,
  },
  {
    id: "ticket" as const,
    icon: "ticket-outline" as const,
    href: CARETIP_SUPPORT_TICKET_MAILTO,
  },
  {
    id: "phone" as const,
    icon: "call-outline" as const,
    href: "tel:+49300000000",
  },
] as const;
