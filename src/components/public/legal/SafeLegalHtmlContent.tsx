import { sanitizeLegalHtmlClient } from "@/lib/safeLegalHtml";
import { publicPageUi } from "@/components/public/publicPageUi";
import { cn } from "@/lib/utils";

type SafeLegalHtmlContentProps = {
  html: string;
};

export function SafeLegalHtmlContent({ html }: SafeLegalHtmlContentProps) {
  const safe = sanitizeLegalHtmlClient(html);

  return (
    <div
      className={cn(publicPageUi.legalProse, "caretip-legal-document__api-html")}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
