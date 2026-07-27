import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { publicPagesBrandUi } from "@/components/public/publicPagesBrandUi";
import { LEGAL_DOCUMENT_ROUTES, type LegalDocumentId } from "@/app/data/legalDocumentsNav";

export type LegalSectionAnchor = {
  id: string;
  title: string;
};

type LegalDocumentsSidebarProps = {
  activeDocument: LegalDocumentId;
  sectionAnchors?: LegalSectionAnchor[];
};

export function LegalDocumentsSidebar({ activeDocument, sectionAnchors = [] }: LegalDocumentsSidebarProps) {
  const { t } = useTranslation();
  const { hash } = useLocation();

  return (
    <aside className="caretip-legal-document__sidebar" aria-label={t("staticPages.legalNav.sidebarAria")}>
      <nav className="caretip-legal-document__sidebar-card" aria-label={t("staticPages.legalNav.documentsAria")}>
        <p className="caretip-legal-document__sidebar-label">{t("staticPages.legalNav.sidebarTitle")}</p>
        <ul className="caretip-legal-document__sidebar-list">
          {LEGAL_DOCUMENT_ROUTES.map((item) => {
            const active = item.id === activeDocument;
            return (
              <li key={item.id}>
                <Link
                  to={item.path}
                  className={cn(
                    "caretip-legal-document__sidebar-link",
                    active && "caretip-legal-document__sidebar-link--active",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {t(`staticPages.legalNav.${item.id}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {sectionAnchors.length > 0 ? (
        <nav className="caretip-legal-document__sidebar-card" aria-label={t("staticPages.legalNav.onThisPage")}>
          <p className="caretip-legal-document__sidebar-label">{t("staticPages.legalNav.onThisPage")}</p>
          <ul className="caretip-legal-document__toc-list">
            {sectionAnchors.map((section) => {
              const href = `#${section.id}`;
              const active = hash === href;
              return (
                <li key={section.id}>
                  <a
                    href={href}
                    className={cn(
                      "caretip-legal-document__toc-link",
                      active && "caretip-legal-document__toc-link--active",
                    )}
                  >
                    {section.title}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      <div className="caretip-legal-document__sidebar-help">
        <p className="caretip-legal-document__sidebar-help-title">{t("staticPages.legalNav.sidebarHelpTitle")}</p>
        <p className="caretip-legal-document__sidebar-help-body">{t("staticPages.legalNav.sidebarHelpBody")}</p>
        <Link to="/contact" className={cn(publicPagesBrandUi.ctaButtonPrimary, "caretip-legal-document__sidebar-cta")}>
          {t("staticPages.legalNav.sidebarHelpButton")}
        </Link>
      </div>
    </aside>
  );
}
