import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  dashboardSidebarNavLinkActive,
  dashboardSidebarNavLinkBase,
  dashboardSidebarNavLinkIdle,
} from "@/lib/theme/dashboardSidebarUi";
import { useProductFeedbackModal } from "./ProductFeedbackModalContext";

type ProductFeedbackSidebarNavItemProps = {
  labelKey: string;
  onNavigate?: () => void;
  /** Business sidebar uses slightly different link classes than employee. */
  variant: "business" | "employee";
  /** Top border + spacing when placed away from customer-facing nav items. */
  separated?: boolean;
};

export function ProductFeedbackSidebarNavItem({
  labelKey,
  onNavigate,
  variant,
  separated = false,
}: ProductFeedbackSidebarNavItemProps) {
  const { t } = useTranslation();
  const { open, openProductFeedback } = useProductFeedbackModal();
  const hint = t("productReview.sidebar.hint");

  const handleClick = () => {
    openProductFeedback();
    onNavigate?.();
  };

  const isBusiness = variant === "business";

  return (
    <li
      className={cn(
        separated && "mt-3 border-t border-sidebar-border/55 pt-2.5",
      )}
    >
      <button
        type="button"
        onClick={handleClick}
        title={hint}
        aria-pressed={open}
        aria-haspopup="dialog"
        className={cn(
          isBusiness
            ? "business-dash-nav-link flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium"
            : cn("employee-dash-nav-link", dashboardSidebarNavLinkBase, "w-full text-left"),
          open
            ? cn(
                isBusiness
                  ? "business-dash-nav-link--active font-semibold text-foreground product-feedback-sidebar-link--modal-open"
                  : cn(
                      "employee-dash-nav-link--active",
                      dashboardSidebarNavLinkActive,
                      "product-feedback-sidebar-link--modal-open",
                    ),
              )
            : isBusiness
              ? dashboardSidebarNavLinkIdle
              : dashboardSidebarNavLinkIdle,
        )}
      >
        <span
          className={cn(
            isBusiness ? "business-dash-nav-icon" : "shrink-0",
            "product-feedback-sidebar-icon text-sidebar-foreground/85 transition-colors",
            open && "text-primary",
          )}
          aria-hidden
        >
          <Sparkles className={isBusiness ? "h-[1.125rem] w-[1.125rem]" : "h-5 w-5"} strokeWidth={1.75} />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 tracking-tight">
          <span className="truncate">{t(labelKey)}</span>
          <span className="text-primary/70 text-[10px] leading-none" aria-hidden>·</span>
        </span>
      </button>
    </li>
  );
}
