import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Activity, CreditCard, Database, HardDrive, ListChecks, Mail, RefreshCw, ScrollText, Server } from "lucide-react";
import { fetchPlatformHealth, type PlatformHealthResponse } from "../../lib/api";
import { logClientError } from "../../lib/clientLog";
import { PlatformPage, PlatformPageHeader } from "../../components/platform/PlatformPageChrome";
import {
  ConsoleCallout,
  ConsoleCard,
  ConsoleDot,
  ConsoleList,
  ConsoleListRow,
  ConsoleStatus,
} from "../../components/platform/console/AdminConsole";
import { formatDateTime } from "../../components/platform/console/consoleFormat";
import { PLATFORM_REPORTS_BASE } from "../../components/platform/platformAdminNav";

type ServiceState = "online" | "offline" | "checking";

export function PlatformSystemHealthPage() {
  const { t, i18n } = useTranslation();
  const [health, setHealth] = useState<PlatformHealthResponse | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetchPlatformHealth();
      setHealth(res);
      setFailed(false);
    } catch (e) {
      logClientError("PlatformSystemHealthPage.check", e);
      setFailed(true);
    } finally {
      setCheckedAt(new Date().toISOString());
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const state = (v: "online" | "offline" | undefined): ServiceState => (failed ? "offline" : !health ? "checking" : v === "online" ? "online" : "offline");
  const services = [
    { key: "db", icon: Database, label: t("admin.networkHero.labelPostgres"), desc: t("admin.console.health.dbDesc"), state: state(health?.database) },
    { key: "stripe", icon: CreditCard, label: t("admin.networkHero.labelStripe"), desc: t("admin.console.health.stripeDesc"), state: state(health?.stripe) },
  ];
  const overall: ServiceState = services.some((s) => s.state === "checking")
    ? "checking"
    : services.every((s) => s.state === "online")
      ? "online"
      : "offline";
  const label = (s: ServiceState) =>
    s === "online" ? t("admin.networkHero.online") : s === "offline" ? t("admin.networkHero.offline") : t("admin.networkHero.checking");
  const tone = (s: ServiceState) => (s === "online" ? "success" : s === "offline" ? "failure" : "neutral");

  return (
    <PlatformPage>
      <PlatformPageHeader
        icon={Activity}
        title={t("admin.systemHealthPage.title")}
        subtitle={t("admin.systemHealthPage.subtitle")}
        actions={
          <button type="button" className="ac-btn ac-btn--secondary" onClick={() => void check()} disabled={checking}>
            <RefreshCw className={checking ? "animate-spin" : undefined} aria-hidden />
            {t("admin.console.health.refresh")}
          </button>
        }
      />

      <ConsoleCallout
        tone={overall === "online" ? "success" : overall === "offline" ? "failure" : "neutral"}
        icon={Server}
        title={
          overall === "online"
            ? t("admin.overview.hero.statusOperational")
            : overall === "offline"
              ? t("admin.overview.hero.statusDegraded")
              : t("admin.overview.hero.statusChecking")
        }
      >
        <span aria-live="polite">
          {checkedAt ? t("admin.console.health.lastChecked", { time: formatDateTime(checkedAt, i18n.language) }) : null}
        </span>
      </ConsoleCallout>

      <section aria-labelledby="health-monitored" className="flex flex-col gap-3">
        <h2 id="health-monitored" className="ac-section-label">
          {t("admin.networkHero.systemHealth")}
        </h2>
        <div className="ac-grid ac-grid--2">
          {services.map((s) => (
            <ConsoleCard key={s.key} tone={s.state === "offline" ? "danger" : undefined}>
              <div className="flex items-start gap-4">
                <span className="ac-kpi__icon" style={{ width: "2.6rem", height: "2.6rem" }} aria-hidden>
                  <s.icon />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-base font-bold">{s.label}</p>
                    <ConsoleStatus tone={tone(s.state)} size="lg">
                      {label(s.state)}
                    </ConsoleStatus>
                  </div>
                  <p className="ac-small ac-muted mt-1">{s.desc}</p>
                </div>
              </div>
            </ConsoleCard>
          ))}
        </div>
      </section>

      <div className="ac-grid ac-grid--wide-narrow">
        <ConsoleCard
          icon={ListChecks}
          title={t("admin.console.health.notReportedTitle")}
          description={t("admin.console.health.notReportedDesc")}
          flush
        >
          <ConsoleList>
            {[
              { key: "queue", icon: Server, label: t("admin.console.health.queue") },
              { key: "email", icon: Mail, label: t("admin.console.health.email") },
              { key: "storage", icon: HardDrive, label: t("admin.console.health.storage") },
            ].map((row) => (
              <ConsoleListRow
                key={row.key}
                leading={
                  <span className="ac-avatar ac-avatar--sm" aria-hidden>
                    <row.icon className="h-4 w-4" />
                  </span>
                }
                title={row.label}
                end={
                  <span className="inline-flex items-center gap-1.5">
                    <ConsoleDot />
                    {t("admin.console.health.notReported")}
                  </span>
                }
              />
            ))}
          </ConsoleList>
        </ConsoleCard>

        <ConsoleCard icon={ScrollText} title={t("admin.networkHero.title")} description={t("admin.networkHero.subtitle")}>
          <Link to={`${PLATFORM_REPORTS_BASE}/audit-logs`} className="ac-btn ac-btn--secondary">
            {t("admin.auditLogsPage.title")}
          </Link>
        </ConsoleCard>
      </div>
    </PlatformPage>
  );
}
