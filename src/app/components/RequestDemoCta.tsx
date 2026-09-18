import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { CARETIP_CALENDLY_URL, openCareTipCalendlyPopup } from "@/app/lib/calendly";
import { cn } from "@/lib/utils";

export type RequestDemoCtaProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "onClick" | "children"
> & {
  children: ReactNode;
  className?: string;
  /** e.g. close mobile nav drawer before opening Calendly */
  onBeforeOpen?: () => void;
};

/**
 * Public marketing “Request Demo” control — opens CareTip Calendly popup.
 * Keeps an href fallback for no-JS / middle-click; primary click uses the popup.
 */
export function RequestDemoCta({
  children,
  className,
  onBeforeOpen,
  ...rest
}: RequestDemoCtaProps) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Allow modified clicks (new tab / download) to use the real Calendly URL.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    onBeforeOpen?.();
    void openCareTipCalendlyPopup();
  };

  return (
    <a
      {...rest}
      href={CARETIP_CALENDLY_URL}
      className={cn(className)}
      onClick={handleClick}
      rel="noopener noreferrer"
      data-caretip-request-demo="true"
    >
      {children}
    </a>
  );
}
