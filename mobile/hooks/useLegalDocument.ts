import { useQuery } from "@tanstack/react-query";
import {
  fetchLegalDocument,
  isLegalDocumentNotFound,
  isLegalNetworkFailure,
  type LegalDocumentKind,
} from "@/services/api/legalService";
import { useI18n } from "@/hooks/useI18n";
import { friendlyErrorMessage } from "@/utils/friendlyError";

export function useLegalDocument(kind: LegalDocumentKind) {
  const { t, language } = useI18n();
  const lang = language.slice(0, 2);

  const query = useQuery({
    queryKey: ["legal-document", kind, lang] as const,
    queryFn: () => fetchLegalDocument(kind, lang),
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      if (isLegalDocumentNotFound(error)) return false;
      return failureCount < 1;
    },
  });

  return {
    ...query,
    isNotFound: query.isError && isLegalDocumentNotFound(query.error),
    isNetworkFailure: query.isError && isLegalNetworkFailure(query.error),
  };
}

export function legalDocumentErrorMessage(error: unknown, t: (key: string) => string): string {
  if (isLegalDocumentNotFound(error)) {
    return t("info.legalNotAvailable");
  }
  if (isLegalNetworkFailure(error)) {
    return t("errors.offline");
  }
  return friendlyErrorMessage(error, t("info.legalLoadError"), t);
}

export { isLegalDocumentNotFound, isLegalNetworkFailure };
