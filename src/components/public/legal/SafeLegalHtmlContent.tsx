import { sanitizeLegalHtmlClient } from "@/lib/safeLegalHtml";
import { publicPageUi } from "@/components/public/publicPageUi";
import { cn } from "@/lib/utils";

type SafeLegalHtmlContentProps = {
  html: string;
  /** When set, a leading `<h1>` matching this title is removed (shell already shows it). */
  pageTitle?: string;
};

export function SafeLegalHtmlContent({ html, pageTitle }: SafeLegalHtmlContentProps) {
  const safe = sanitizeLegalHtmlClient(html, pageTitle);

  return (
    <div
      className={cn(publicPageUi.legalProse, "caretip-legal-document__api-html")}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
