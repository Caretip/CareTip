import { Navigate, useParams } from "react-router";
import "@/styles/bundles/marketing-pages.css";
import { isIndustryPageId } from "@/app/data/industryPages";
import { IndustryPageTemplate } from "@/components/industries/IndustryPageTemplate";
import { usePublicMountProbe } from "@/lib/publicMountProbe";

export function IndustryPage() {
  usePublicMountProbe("IndustryPage");
  const { industryId } = useParams<{ industryId: string }>();

  if (!industryId || !isIndustryPageId(industryId)) {
    return <Navigate to="/" replace />;
  }

  return <IndustryPageTemplate industryId={industryId} />;
}
