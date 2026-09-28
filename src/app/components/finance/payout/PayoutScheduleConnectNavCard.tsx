import { Link } from "react-router";
import { ArrowRight, CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/button";
import { cn } from "@/lib/utils";

export function PayoutScheduleConnectNavCard({
  to,
  titleKey,
  bodyKey,
  linkKey,
  className,
}: {
  to: string;
  titleKey: string;
  bodyKey: string;
  linkKey: string;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <section
      className={cn(
        "rounded-xl border border-border/70 bg-muted/20 px-4 py-4 sm:flex sm:items-center sm:justify-between sm:gap-4",
        className,
      )}
      aria-labelledby="payout-schedule-connect-nav-heading"
    >
      <div className="flex min-w-0 gap-3">
        <span
          className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-sm ring-1 ring-border/60"
          aria-hidden
        >
          <CalendarClock className="h-4 w-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 id="payout-schedule-connect-nav-heading" className="text-sm font-semibold tracking-tight">
            {t(titleKey)}
          </h2>
          <p className="text-sm leading-snug text-muted-foreground">{t(bodyKey)}</p>
        </div>
      </div>
      <Button asChild variant="outline" className="mt-3 w-full min-h-11 shrink-0 sm:mt-0 sm:w-auto">
        <Link to={to}>
          {t(linkKey)}
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
        </Link>
      </Button>
    </section>
  );
}
