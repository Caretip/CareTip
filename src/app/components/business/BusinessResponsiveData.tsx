import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { businessUi } from "./businessDashboardUi";

type BusinessResponsiveDataProps = {
  mobile: ReactNode;
  desktop: ReactNode;
  className?: string;
  panelClassName?: string;
};

/** Desktop table + mobile card list — consistent with platform admin pattern. */
export function BusinessResponsiveData({
  mobile,
  desktop,
  className,
  panelClassName,
}: BusinessResponsiveDataProps) {
  return (
    <div className={cn(businessUi.tablePanel, panelClassName, className)}>
      <div className={businessUi.mobileList}>{mobile}</div>
      <div className={businessUi.tableWrap}>{desktop}</div>
    </div>
  );
}
