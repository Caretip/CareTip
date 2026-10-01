import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchLegalDocument, type LegalDocumentKind, type LegalDocumentResponse } from "@/app/lib/legalApi";
import { SafeLegalHtmlContent } from "@/components/public/legal/SafeLegalHtmlContent";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";

type CustomerJourneyLegalDialogProps = {
  kind: LegalDocumentKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CustomerJourneyLegalDialog({ kind, open, onOpenChange }: CustomerJourneyLegalDialogProps) {
  const { t, i18n } = useTranslation();
  const [doc, setDoc] = useState<LegalDocumentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchLegalDocument(kind, i18n.language?.slice(0, 2))
      .then((result) => {
        if (!cancelled) setDoc(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDoc(null);
          setError(err instanceof Error ? err.message : t("legal.loadError"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, kind, i18n.language, t]);

  const title = doc?.title || t(kind === "privacy" ? "legal.privacyTitle" : "legal.termsTitle");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88vh,720px)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
          <DialogTitle className="text-left text-base sm:text-lg">{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("legal.loading")}</p>
          ) : error ? (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          ) : doc ? (
            <SafeLegalHtmlContent html={doc.contentHtml} pageTitle={title} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
