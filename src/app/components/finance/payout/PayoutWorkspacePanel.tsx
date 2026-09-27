import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { payoutWorkspacePanelClass, payoutWorkspacePanelPadding } from "./payoutWorkspaceClasses";

export function PayoutWorkspacePanel({
  children,
  className,
  paddingClassName,
  "aria-labelledby": ariaLabelledby,
  "aria-busy": ariaBusy,
}: {
  children: ReactNode;
  className?: string;
  paddingClassName?: string;
  "aria-labelledby"?: string;
  "aria-busy"?: boolean;
}) {
  return (
    <section
      className={cn(payoutWorkspacePanelClass(), payoutWorkspacePanelPadding(paddingClassName), className)}
      aria-labelledby={ariaLabelledby}
      aria-busy={ariaBusy}
    >
      {children}
    </section>
  );
}
