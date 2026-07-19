import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./useAuth";
import { fetchBusinessProfile, type BusinessInfo } from "../lib/api";
import { logClientError } from "../lib/clientLog";

/** Venue name + logo for business manager shells (sidebar, header, etc.). */
export function useBusinessVenueBrand() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [profile, setProfile] = useState<BusinessInfo | null>(null);

  useEffect(() => {
    if (!user?.businessId || user.role !== "business") {
      setProfile(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      void fetchBusinessProfile()
        .then((p) => {
          if (!cancelled) setProfile(p);
        })
        .catch((e) => {
          logClientError("useBusinessVenueBrand", e);
          if (!cancelled) setProfile(null);
        });
    };
    load();
    const onProfileChanged = () => load();
    window.addEventListener("caretip-business-profile-changed", onProfileChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("caretip-business-profile-changed", onProfileChanged);
    };
  }, [user?.businessId, user?.role]);

  const venueName =
    String(profile?.name ?? user?.businessName ?? "").trim() || t("dashboard.venueDashboardFallback");

  return {
    venueName,
    logo: profile?.logo ?? null,
    businessType: profile?.type?.trim() || null,
    profile,
  };
}
