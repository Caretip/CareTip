import { cn } from "@/lib/utils";
import {
  physicalQrStatusBadgeClasses,
  type PhysicalQrStatusTone,
} from "@/app/lib/physicalQrOrderUi";

type PhysicalQrStatusBadgeProps = {
  tone: PhysicalQrStatusTone;
  label: string;
  className?: string;
};

export function PhysicalQrStatusBadge({ tone, label, className }: PhysicalQrStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-snug",
        physicalQrStatusBadgeClasses(tone),
        className,
      )}
    >
      {label}
    </span>
  );
}
