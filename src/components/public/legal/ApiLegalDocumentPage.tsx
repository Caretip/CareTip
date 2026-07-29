import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchLegalDocument, type LegalDocumentKind, type LegalDocumentResponse } from "@/app/lib/legalApi";
import { PublicLegalPageShell } from "@/components/public/PublicLegalPageShell";
import { SafeLegalHtmlContent } from "@/components/public/legal/SafeLegalHtmlContent";

type ApiLegalDocumentPageProps = {
  kind: LegalDocumentKind;
  /** i18n key used only while loading / if API title missing */
  titleKey: string;
};

export function ApiLegalDocumentPage({ kind, titleKey }: ApiLegalDocumentPageProps) {
  const { t, i18n } = useTranslation();
  const [doc, setDoc] = useState<LegalDocumentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, [kind, i18n.language, t]);

  const title = doc?.title || t(titleKey);
  const subtitle = doc
    ? t("legal.versionLine", {
        version: doc.version,
        date: new Date(doc.updatedAt).toLocaleDateString(i18n.language),
      })
    : undefined;

  return (
    <PublicLegalPageShell title={title} subtitle={subtitle}>
      {loading ? (
        <p className="text-muted-foreground">{t("legal.loading")}</p>
      ) : error ? (
        <div className="space-y-3" role="alert">
          <p className="text-muted-foreground">{error}</p>
          <button
            type="button"
            className="text-primary font-semibold underline-offset-2 hover:underline"
            onClick={() => {
              setLoading(true);
              setError(null);
              void fetchLegalDocument(kind, i18n.language?.slice(0, 2))
                .then(setDoc)
                .catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : t("legal.loadError")),
                )
                .finally(() => setLoading(false));
            }}
          >
            {t("legal.tryAgain")}
          </button>
        </div>
      ) : doc ? (
        <SafeLegalHtmlContent html={doc.contentHtml} />
      ) : null}
    </PublicLegalPageShell>
  );
}
