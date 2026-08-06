import { CheckCircle2, Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";

type AuthEmployeeVenueBannerProps = {
  businessName?: string;
  businessLocation?: string | null;
  verified?: boolean;
};

/** Confirms invite validation and venue context while completing an employee invitation. */
export function AuthEmployeeVenueBanner({
  businessName,
  businessLocation,
  verified = true,
}: AuthEmployeeVenueBannerProps) {
  const { t } = useTranslation();
  const venueLabel = businessName?.trim() || t("auth.employeeAuth.venueFallback");

  return (
    <div className="caretip-auth-employee-venue" role="status">
      {verified ? (
        <p className="caretip-auth-employee-venue__verified">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          {t("auth.employeeAuth.inviteVerified")}
        </p>
      ) : null}
      <p className="caretip-auth-employee-venue__label">{t("auth.employeeAuth.joiningLabel")}</p>
      <div className="caretip-auth-employee-venue__card">
        <Building2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="caretip-auth-employee-venue__name">{venueLabel}</p>
          {businessLocation?.trim() ? (
            <p className="caretip-auth-employee-venue__location">{businessLocation.trim()}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
