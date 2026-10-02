import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { PlatformPage, PlatformPageHeader, PlatformAdminSection } from "../../../components/platform/PlatformPageChrome";

export function PlatformSecurityReportsPage() {
  const { t } = useTranslation();
  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Shield}
        title={t("admin.securityReportsPage.title")}
        subtitle={t("admin.securityReportsPage.subtitle")}
      />
      <PlatformAdminSection>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("admin.securityReportsPage.body")}</p>
      </PlatformAdminSection>
    </PlatformPage>
  );
}
