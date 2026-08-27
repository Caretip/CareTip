import { cn } from "@/lib/utils";
import { caretipBtnPrimary } from "@/lib/caretipButtonSystem";

export const contactPageUi = {
  page: "caretip-contact-page",
  layout: "caretip-contact-layout",
  intro: "caretip-contact-intro",
  headline: "caretip-contact-headline",
  subhead: "caretip-contact-subhead",
  cards: "caretip-contact-intent-cards",
  card: "caretip-contact-intent-card",
  cardTitle: "caretip-contact-intent-card__title",
  cardBody: "caretip-contact-intent-card__body",
  flow: "caretip-contact-flow",
  flowAside: "caretip-contact-flow__aside",
  flowTitle: "caretip-contact-flow__title",
  flowList: "caretip-contact-flow__list",
  flowAlt: "caretip-contact-flow__alt",
  flowForm: "caretip-contact-flow__form",
  back: "caretip-contact-back",
  form: "caretip-contact-form",
  field: "caretip-contact-field",
  label: "caretip-contact-label",
  input:
    "caretip-contact-input w-full rounded-xl border border-border/80 bg-input-background px-4 py-3 text-foreground placeholder:text-muted-foreground transition-[box-shadow,border-color,background-color] focus:outline-none focus:ring-2 focus:ring-primary/30",
  textarea:
    "caretip-contact-input caretip-contact-textarea w-full resize-none rounded-xl border border-border/80 bg-input-background px-4 py-3 text-foreground placeholder:text-muted-foreground transition-[box-shadow,border-color,background-color] focus:outline-none focus:ring-2 focus:ring-primary/30",
  submit: cn(caretipBtnPrimary, "caretip-contact-submit w-full justify-center sm:w-auto sm:min-w-[11rem]"),
} as const;

export function contactFieldClass(className?: string) {
  return cn(contactPageUi.field, className);
}
