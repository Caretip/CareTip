import { useNavigate, useParams, Link } from "react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTipFlow } from "../../context/TipFlowContext";
import {
  getBusinessStaffDirectory,
  recordGuestQrScanOnce,
  type BusinessDirectoryEmployee,
  type BusinessDirectoryResponse,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { CareTipPageLoader } from "../../components/CareTipPageLoader";
import { usePublicSocket } from "../../hooks/usePublicSocket";
import { useRealtimeFallback } from "../../hooks/useRealtimeFallback";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerJourneyHeader, CustomerJourneyHomeButton } from "./CustomerJourneyHeader";
import { CustomerJourneyAttributionFooter } from "./CustomerJourneyCareTipAttribution";
import { venueBrandFromBusiness } from "./customerJourneyBrand";
import { headerSelectTeamMember } from "./customerJourneyHeaderCopy";
import { CustomerTeamPicker } from "./CustomerTeamPicker";

/**
 * Path B: `/{businessSlug}` (legacy redirect from `/business/:businessSlug`) — Business QR (staff directory).
 * Searchable grid of active employees; tap opens tip flow for that person.
 */
export function BusinessStaffDirectoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { businessSlug } = useParams<{ businessSlug: string }>();
  const { setBusinessId, setEmployee, setStaffProfileSlug, setStaffTipReturnPath } = useTipFlow();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BusinessDirectoryResponse | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const raw = businessSlug?.trim().toLowerCase();
    if (!raw) {
      setError(t("tipFlow.errors.invalidLink"));
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getBusinessStaffDirectory(raw);
        if (cancelled) return;
        recordGuestQrScanOnce({
          businessId: res.business.id,
          scanType: "business_directory",
          entryPath: window.location.pathname,
        });
        setData(res);
        setBusinessId(res.business.id);
      } catch (e) {
        logClientError("BusinessStaffDirectoryPage", e);
        if (!cancelled) {
          setError(toUserFriendlyMessage(e));
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessSlug, setBusinessId, t]);

  const filtered = useMemo(() => {
    const list = data?.employees ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (e) => e.name.toLowerCase().includes(q) || e.jobTitle.toLowerCase().includes(q)
    );
  }, [data?.employees, query]);

  const pickEmployee = (emp: BusinessDirectoryEmployee) => {
    if (!data) return;
    setBusinessId(data.business.id);
    setEmployee(emp.id, emp.name, emp.avatar ?? undefined);
    const qs = new URLSearchParams({ employeeId: emp.id });
    const bizSlug = data.business.slug?.trim();
    const empSlug = emp.slug?.trim();
    if (bizSlug && empSlug) {
      setStaffTipReturnPath(bizSlug, empSlug);
      qs.set("returnBusinessSlug", bizSlug);
      qs.set("returnEmployeeSlug", empSlug);
      qs.set("direct", "1");
    } else {
      setStaffProfileSlug(emp.slug ?? null);
      if (emp.slug) {
        qs.set("returnSlug", emp.slug);
        qs.set("direct", "1");
      }
    }
    navigate(`/tip-amount?${qs.toString()}`);
  };

  const businessIdForSocket = data?.business.id ?? null;
  const { socket, connected } = usePublicSocket(businessIdForSocket);

  const reloadDirectory = useCallback(async () => {
    const raw = businessSlug?.trim().toLowerCase();
    if (!raw) return;
    try {
      const res = await getBusinessStaffDirectory(raw);
      setData(res);
      setBusinessId(res.business.id);
    } catch (e) {
      logClientError("BusinessStaffDirectoryPage.reload", e);
    }
  }, [businessSlug, setBusinessId]);

  useRealtimeFallback(connected, reloadDirectory, 60000);

  useEffect(() => {
    if (!socket || !data) return;
    const r = () => void reloadDirectory();
    socket.on("business_data_updated", r);
    return () => {
      socket.off("business_data_updated", r);
    };
  }, [socket, data, reloadDirectory]);

  if (loading) {
    return (
      <CareTipPageLoader
        variant="wait"
        context="tipPage"
        registrationKey="business-staff-directory"
      />
    );
  }

  if (error || !data) {
    return (
      <div className={cf.stateCenter}>
        <p className={cf.stateError}>{error ?? t("tipFlow.common.notFound")}</p>
        <Link to="/" className="mt-4 text-sm font-semibold text-primary underline-offset-2 hover:underline">
          {t("tipFlow.common.goHomeLink")}
        </Link>
      </div>
    );
  }

  const teamHeader = headerSelectTeamMember(t);

  return (
    <div className={`${cf.pageTeam} pb-10 sm:pb-12`}>
      <div className={cf.frame}>
      <CustomerJourneyHeader
        leading={
          <CustomerJourneyHomeButton
            ariaLabel={t("tipFlow.common.homeAria")}
            onClick={() => navigate("/")}
          />
        }
        venue={venueBrandFromBusiness(data.business)}
        stepTitle={teamHeader.stepTitle}
      />

      <div className={cf.mainTeam}>
        <CustomerTeamPicker
          searchLabel={t("tipFlow.locationLanding.searchTitle")}
          searchPlaceholder={t("tipFlow.qrLanding.searchPlaceholder")}
          teamLabel={t("tipFlow.locationLanding.teamTitle")}
          emptyLabel={t("tipFlow.qrLanding.noMatches")}
          query={query}
          onQueryChange={setQuery}
          employees={filtered}
          onPick={pickEmployee}
          tipButtonLabel={t("tipFlow.qrLanding.tipCta")}
          tipButtonAria={(name) => t("tipFlow.locationLanding.tipPerson", { name })}
        />
      </div>

      <CustomerJourneyAttributionFooter label={t("tipFlow.common.poweredByCareTip")} />
      </div>
    </div>
  );
}
