import { InfoScreenShell } from "@/components/info/InfoScreenShell";
import {
  LegalDocumentEmpty,
  LegalDocumentError,
  LegalDocumentLoading,
  LegalDocumentView,
} from "@/components/info/LegalDocumentView";
import { legalDocumentErrorMessage, useLegalDocument } from "@/hooks/useLegalDocument";
import { useI18n } from "@/hooks/useI18n";
import type { LegalDocumentKind } from "@/services/api/legalService";

type LegalScreenProps = {
  kind: LegalDocumentKind;
};

const TITLE_KEYS: Record<LegalDocumentKind, "info.privacyTitle" | "info.termsTitle" | "info.impressumTitle"> = {
  privacy: "info.privacyTitle",
  terms: "info.termsTitle",
  impressum: "info.impressumTitle",
};

export function LegalScreen({ kind }: LegalScreenProps) {
  const { t } = useI18n();
  const query = useLegalDocument(kind);
  const fallbackTitle = t(TITLE_KEYS[kind]);

  return (
    <InfoScreenShell title={query.data?.title ?? fallbackTitle} scroll={false}>
      {query.isLoading && !query.data ? (
        <LegalDocumentLoading />
      ) : query.isNotFound ? (
        <LegalDocumentEmpty message={t("info.legalNotAvailable")} />
      ) : query.isError || !query.data ? (
        <LegalDocumentError
          message={legalDocumentErrorMessage(query.error, t)}
          onRetry={query.isNetworkFailure ? () => void query.refetch() : undefined}
        />
      ) : (
        <LegalDocumentView
          title={query.data.title}
          contentHtml={query.data.contentHtml}
          version={query.data.version}
          updatedAt={query.data.updatedAt}
        />
      )}
    </InfoScreenShell>
  );
}
