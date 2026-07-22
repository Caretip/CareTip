import { FeatureGate } from "@/app/components/subscription/FeatureGate";
import { QrStudioDesigner } from "../../../components/business/QrStudioDesigner";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { useTranslation } from "react-i18next";

/** QR Studio — premium branded experience designer. */
export function QrStudioBrandingPage() {
  const { t } = useTranslation();
  const { user } = useRequireAuth();

  return (
    <FeatureGate featureKey="brandingCustomization" role="business">
      <QrStudioDesigner
        businessId={user?.businessId}
        businessName={
          user?.businessName?.trim() ||
          user?.name?.trim() ||
          t("dashboard.venueDashboardFallback")
        }
        canEdit
        initialSection="branding"
      />
    </FeatureGate>
  );
}
