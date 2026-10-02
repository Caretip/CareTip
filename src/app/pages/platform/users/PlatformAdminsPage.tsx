import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { PlatformPage, PlatformPageHeader, PlatformAdminSection } from "../../../components/platform/PlatformPageChrome";

export function PlatformAdminsPage() {
  const { t } = useTranslation();
  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Shield}
        title={t("admin.platformAdminsPage.title")}
        subtitle={t("admin.platformAdminsPage.subtitle")}
      />
      <PlatformAdminSection>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("admin.platformAdminsPage.body")}</p>
      </PlatformAdminSection>
    </PlatformPage>
  );
}
