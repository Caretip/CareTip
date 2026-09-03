import type { ElementType, ReactNode } from "react";
import { motion } from "motion/react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { platformUi } from "./platformDashboardUi";

export function PlatformPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(platformUi.page, className)}>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className={platformUi.pageInner}
      >
        {children}
      </motion.div>
    </div>
  );
}

export function PlatformPageHeader({
  icon: Icon,
  title,
  subtitle,
  className,
  children,
}: {
  icon: ElementType;
  title: string;
  subtitle?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header className={cn(platformUi.pageHeader, className)}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="space-y-4"
      >
        <div className={platformUi.pageTitleRow}>
          <Icon className={platformUi.pageTitleIcon} aria-hidden />
          <div className="min-w-0 flex-1">
            <h1 className={platformUi.pageTitle}>{title}</h1>
            {subtitle ? <p className={platformUi.pageSubtitle}>{subtitle}</p> : null}
          </div>
        </div>
        {children}
      </motion.div>
    </header>
  );
}

export function PlatformSearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  hint,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn(platformUi.searchSection, className)}>
      <div className={platformUi.searchWrap}>
        <Search className={platformUi.searchIcon} aria-hidden />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          aria-label={ariaLabel}
          className={platformUi.searchInput}
        />
      </div>
      {hint ? <p className={platformUi.searchHint}>{hint}</p> : null}
    </div>
  );
}

export function PlatformDataPanel({
  children,
  footer,
  className,
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 }}
      className={cn(platformUi.dataPanel, className)}
    >
      {children}
      {footer ? <div className={platformUi.panelFooter}>{footer}</div> : null}
    </motion.section>
  );
}

export function PlatformResponsiveData({
  mobile,
  desktop,
  footer,
}: {
  mobile: ReactNode;
  desktop: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <PlatformDataPanel footer={footer}>
      <div className={platformUi.mobileList}>{mobile}</div>
      <div className={platformUi.tableWrap}>{desktop}</div>
    </PlatformDataPanel>
  );
}
