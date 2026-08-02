import { useNavigate, useParams, Link } from "react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Building2, Search } from "lucide-react";
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
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { usePublicSocket } from "../../hooks/usePublicSocket";
import { useRealtimeFallback } from "../../hooks/useRealtimeFallback";
import { LiveConnectionBadge } from "../../components/LiveConnectionBadge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerJourneyHeader, CustomerJourneyHomeButton } from "./CustomerJourneyHeader";
import { CustomerJourneyAttributionFooter } from "./CustomerJourneyCareTipAttribution";
import { venueBrandFromBusiness } from "./customerJourneyBrand";
import { headerSelectTeamMember } from "./customerJourneyHeaderCopy";

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
  }, [businessSlug, setBusinessId]);

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
  const { socket, connected, connectionStatus } = usePublicSocket(businessIdForSocket);

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
    <div className={`${cf.page} pb-10 sm:pb-12`}>
      <CustomerJourneyHeader
        leading={
          <CustomerJourneyHomeButton
            ariaLabel={t("tipFlow.common.homeAria")}
            onClick={() => navigate("/")}
          />
        }
        trailing={<LiveConnectionBadge status={connectionStatus} className="shrink-0" />}
        venue={venueBrandFromBusiness(data.business)}
        stepTitle={teamHeader.stepTitle}
        trustMessage={teamHeader.trustMessage}
      />

      <div className={`${cf.main} lg:space-y-8`}>
        <Card className={cf.cardSearchLight}>
          <CardHeader className={`${cf.cardHeaderPadding} pb-3`}>
            <CardTitle className={cf.cardTitle}>{t("tipFlow.locationLanding.searchTitle")}</CardTitle>
            <CardDescription className={cf.cardDesc}>{t("tipFlow.locationLanding.searchDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-5 sm:px-6">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder={t("tipFlow.qrLanding.searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={`${cf.inputField} pl-11`}
                autoComplete="off"
              />
            </div>
          </CardContent>
        </Card>

        <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <Card className={cf.cardShadcn}>
            <CardHeader className={`${cf.cardHeaderPadding} pb-3`}>
              <CardTitle className={cf.cardTitle}>{t("tipFlow.locationLanding.teamTitle")}</CardTitle>
              <CardDescription className={cf.cardDesc}>{t("tipFlow.locationLanding.teamDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-5 sm:px-6">
              {filtered.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">{t("tipFlow.qrLanding.noMatches")}</p>
              ) : (
                <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 sm:gap-5">
                  {filtered.map((emp, index) => (
                    <motion.li
                      key={emp.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <button
                        type="button"
                        onClick={() => pickEmployee(emp)}
                        className={cf.employeeCard}
                      >
                        <ProfileAvatar
                          src={emp.avatar}
                          displayName={emp.name}
                          className={cf.employeeAvatar}
                        />
                        <div className="min-w-0 text-center">
                          <span className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
                            {emp.name}
                          </span>
                          <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{emp.jobTitle}</span>
                        </div>
                      </button>
                    </motion.li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <Card className={cf.trustCard}>
          <CardContent className="flex items-center justify-center gap-2 px-5 py-4 text-center text-xs font-medium leading-relaxed text-muted-foreground">
            <Building2 className="size-4 shrink-0 text-emerald-700/75 dark:text-emerald-400/80" aria-hidden />
            <span>{t("tipFlow.qrLanding.secureFooter")}</span>
          </CardContent>
        </Card>
      </div>

      <CustomerJourneyAttributionFooter label={t("tipFlow.common.poweredByCareTip")} />
    </div>
  );
}
