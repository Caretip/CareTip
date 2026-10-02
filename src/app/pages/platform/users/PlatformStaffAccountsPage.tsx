import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { PlatformPage, PlatformPageHeader, PlatformAdminSection } from "../../../components/platform/PlatformPageChrome";

export function PlatformStaffAccountsPage() {
  const { t } = useTranslation();
  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Users}
        title={t("admin.staffAccountsPage.title")}
        subtitle={t("admin.staffAccountsPage.subtitle")}
      />
      <PlatformAdminSection>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("admin.staffAccountsPage.body")}</p>
      </PlatformAdminSection>
    </PlatformPage>
  );
}
