import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FixPrompt, type FixPromptDensity } from "../FixPrompt";
import { EMPLOYEE_PAYMENTS_CONNECT_HREF } from "./employeeDashboardNav";
import {
  employeeConnectIsBusinessDistribution,
  isEmployeePayoutReady,
} from "./employeePayoutAccountPresentation";
import { getEmployeeConnectStatus, type EmployeeConnectStatus } from "../../lib/api";
import { logClientError } from "../../lib/clientLog";

type EmployeeStripeConnectPromptProps = {
  density?: FixPromptDensity;
  className?: string;
};

export function EmployeeStripeConnectPrompt({ density, className }: EmployeeStripeConnectPromptProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<EmployeeConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getEmployeeConnectStatus()
      .then((status) => {
        if (!cancelled) {
          setData(status);
          setError(false);
        }
      })
      .catch((err) => {
        logClientError("EmployeeStripeConnectPrompt", err);
        if (!cancelled) {
          setData(null);
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const issueActive =
    !loading &&
    !error &&
    data != null &&
    data.stripeConfigured !== false &&
    !employeeConnectIsBusinessDistribution(data) &&
    !isEmployeePayoutReady(data);
  const conditionVersion = data?.connectionState ?? "not_connected";

  return (
    <FixPrompt
      id="stripeConnect"
      issueActive={issueActive}
      conditionVersion={conditionVersion}
      tone="info"
      density={density}
      title={t("employee.dashboard.fixConnectTitle")}
      description={t("employee.dashboard.fixConnectDesc")}
      actionLabel={t("employee.dashboard.fixConnectAction")}
      actionTo={EMPLOYEE_PAYMENTS_CONNECT_HREF}
      className={className}
    />
  );
}
