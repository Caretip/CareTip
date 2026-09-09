import { useNavigate, useParams, Link } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { useTipFlow } from "../../context/TipFlowContext";
import {
  getPublicLocationContext,
  recordGuestQrScanOnce,
  type BusinessDirectoryEmployee,
  type PublicLocationContextResponse,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { CareTipPageLoader } from "../../components/CareTipPageLoader";
import { getRepeatTipDataForBusiness } from "../../lib/repeatTip";
import { markCustomerFlowEntered } from "../../lib/customerFlowGuard";
import { formatEur } from "../../lib/formatEur";
import { startGuestTipCheckout } from "../../lib/startGuestTipCheckout";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerJourneyHeader, CustomerJourneyHomeButton } from "./CustomerJourneyHeader";
import { CustomerJourneyAttributionFooter } from "./CustomerJourneyCareTipAttribution";
import { venueBrandFromBusiness } from "./customerJourneyBrand";
import { headerSelectTeamMember } from "./customerJourneyHeaderCopy";
import { CustomerTeamPicker } from "./CustomerTeamPicker";
import { CustomerRepeatTipPrompt } from "./CustomerRepeatTipPrompt";

/**
 * /qr/location/:locationId — Venue QR: business team list in context of one location.
 */
export function LocationQrLandingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locationId } = useParams<{ locationId: string }>();
  const { setBusinessId, setEmployee, setStaffProfileSlug, setStaffTipReturnPath, setTippingVenue, setAmount } = useTipFlow();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PublicLocationContextResponse | null>(null);
  const [query, setQuery] = useState("");
  const [repeatDismissed, setRepeatDismissed] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    const raw = locationId?.trim();
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
        const res = await getPublicLocationContext(raw);
        if (cancelled) return;
        recordGuestQrScanOnce({
          businessId: res.business.id,
          scanType: "location",
          locationId: res.location.id,
          entryPath: window.location.pathname,
          notify: { locationName: res.location.name },
        });
        setData(res);
        setBusinessId(res.business.id);
        setTippingVenue({
          locationId: res.location.id,
          locationName: res.location.name,
        });
      } catch (e) {
        logClientError("LocationQrLandingPage", e);
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
  }, [locationId, setBusinessId, setTippingVenue, t]);

  const filtered = useMemo(() => {
    const list = data?.employees ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.jobTitle.toLowerCase().includes(q)
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

  const repeatCandidate = useMemo(() => {
    if (!data?.business?.id || repeatDismissed) return null;
    const d = getRepeatTipDataForBusiness(data.business.id);
    if (!d) return null;
    const emp = (data.employees ?? []).find((e) => e.id === d.employeeId) ?? null;
    if (!emp) return null;
    return { emp, amount: d.lastAmount };
  }, [data?.business?.id, data?.employees, repeatDismissed]);

  if (loading) {
    return (
      <CareTipPageLoader
        variant="wait"
        context="tipPage"
        registrationKey="location-qr-loading"
      />
    );
  }

  if (error || !data) {
    return (
      <div className={cf.stateCenter}>
        <p className={cf.stateError}>{error ?? t("tipFlow.common.notFound")}</p>
        <Link to="/" className={`mt-4 text-sm font-semibold text-primary underline-offset-2 hover:underline`}>
          {t("tipFlow.common.goHomeLink")}
        </Link>
      </div>
    );
  }

  const teamHeader = headerSelectTeamMember(t);

  const handleRepeatTip = async () => {
    if (!repeatCandidate || !data) return;
    setBusinessId(data.business.id);
    setEmployee(
      repeatCandidate.emp.id,
      repeatCandidate.emp.name ?? t("tipFlow.common.teamMember"),
      repeatCandidate.emp.avatar ?? undefined,
    );
    const bs = data.business.slug?.trim();
    const es = repeatCandidate.emp.slug?.trim();
    if (bs && es) setStaffTipReturnPath(bs, es);
    else setStaffProfileSlug(repeatCandidate.emp.slug);
    setAmount(repeatCandidate.amount);
    markCustomerFlowEntered();
    setCheckingOut(true);
    const result = await startGuestTipCheckout(
      {
        amount: repeatCandidate.amount,
        employeeId: repeatCandidate.emp.id,
        businessId: data.business.id,
        employeeName: repeatCandidate.emp.name,
        locationId: data.location.id,
      },
      t("tipFlow.payment.checkoutStartError"),
    );
    if (result !== "redirected") setCheckingOut(false);
  };

  return (
    <div className={`${cf.pageTeam} pb-8 sm:pb-10`}>
      <div className={cf.frame}>
      <CustomerJourneyHeader
        leading={
          <CustomerJourneyHomeButton
            ariaLabel={t("tipFlow.common.homeAria")}
            onClick={() => navigate("/")}
          />
        }
        venue={venueBrandFromBusiness(data.business, (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {data.location.name}
          </span>
        ))}
        stepTitle={teamHeader.stepTitle}
      />

      <div className={`${cf.mainTeam} space-y-8`}>
        {repeatCandidate ? (
          <CustomerRepeatTipPrompt
            employeeName={repeatCandidate.emp.name ?? t("tipFlow.common.teamMember")}
            employeeAvatar={repeatCandidate.emp.avatar}
            body={t("tipFlow.qrLanding.repeatBody", {
              name: repeatCandidate.emp.name ?? t("tipFlow.common.teamMember"),
            })}
            lastTipLabel={t("tipFlow.qrLanding.repeatLastTip", { amount: formatEur(repeatCandidate.amount) })}
            primaryLabel={t("tipFlow.qrLanding.tipAgain")}
            secondaryLabel={t("tipFlow.qrLanding.chooseDifferentStaff")}
            onPrimary={() => void handleRepeatTip()}
            onSecondary={() => setRepeatDismissed(true)}
            primaryDisabled={checkingOut}
          />
        ) : null}

        <CustomerTeamPicker
          searchLabel={t("tipFlow.locationLanding.searchTitle")}
          searchPlaceholder={t("tipFlow.qrLanding.searchPlaceholder")}
          teamLabel={t("tipFlow.locationLanding.teamTitle")}
          emptyLabel={t("tipFlow.locationLanding.noMatches")}
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
