import type { ReactNode } from "react";
import "@/styles/bundles/marketing-pages.css";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { PublicPageBackLink } from "@/components/public/PublicPageBackLink";
import { publicPageUi } from "@/components/public/publicPageUi";
import { cn } from "@/lib/utils";

type PublicLegalPageShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

/**
 * Legal / policy pages — flat page surface, left-aligned copy, no cards.
 */
export function PublicLegalPageShell({ title, subtitle, children }: PublicLegalPageShellProps) {
  return (
    <PublicPageShell className="caretip-legal-document-page">
      <header className="caretip-legal-document-page__header">
        <PublicPageBackLink />
        <h1 className={cn(publicPageUi.title, "caretip-legal-document-page__title")}>{title}</h1>
        {subtitle ? (
          <p className={cn(publicPageUi.subtitle, "caretip-legal-document-page__subtitle")}>{subtitle}</p>
        ) : null}
      </header>
      <div className={cn(publicPageUi.sectionGap, "caretip-legal-document-page__body", publicPageUi.legalProse)}>
        {children}
      </div>
    </PublicPageShell>
  );
}
