import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { CreditCard, Users, ShoppingBag, TrendingUp } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ReactNode } from "react";
import { STRIPE_CONNECT_HREF, TEAM_BASE, QR_STUDIO_BASE } from "./businessDashboardNav";

interface CareTipUsageGuidelinesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function guideLine(t: (key: string, opts?: { defaultValue: string }) => string, key: string): string {
  return t(key, { defaultValue: "" }).trim();
}

function GuideLink({
  to,
  onNavigate,
  children,
}: {
  to: string;
  onNavigate: () => void;
  children?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="font-semibold text-foreground underline underline-offset-2 hover:text-primary"
      onClick={onNavigate}
    >
      {children}
    </Link>
  );
}

export function CareTipUsageGuidelinesDialog({
  open,
  onOpenChange,
}: CareTipUsageGuidelinesDialogProps) {
  const { t } = useTranslation();
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border border-border sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl tracking-tight text-foreground">
            {t("business.dashboard.guidelinesDialogTitle")}
          </DialogTitle>
          <DialogDescription className="text-left text-muted-foreground">
            {t("business.dashboard.guidelinesDialogDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-8 pt-2 text-sm text-foreground">
          <section className="border-l-[3px] border-l-foreground/80 pl-4">
            <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
              <CreditCard className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              {t("business.dashboard.guidelinesSectionStripeTitle")}
            </h3>
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              <li>
                <Trans
                  i18nKey="business.dashboard.guidelinesSectionStripeLi1"
                  components={{
                    stripeLink: <GuideLink to={STRIPE_CONNECT_HREF} onNavigate={close} />,
                  }}
                />
              </li>
              <li>{t("business.dashboard.guidelinesSectionStripeLi2")}</li>
            </ul>
          </section>

          <section className="border-l-[3px] border-l-border pl-4">
            <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
              <Users className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              {t("business.dashboard.guidelinesSectionOnboardTitle")}
            </h3>
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              <li>
                <Trans
                  i18nKey="business.dashboard.guidelinesSectionOnboardLi1"
                  components={{
                    teamLink: <GuideLink to={`${TEAM_BASE}/employees`} onNavigate={close} />,
                  }}
                />
              </li>
              <li>{t("business.dashboard.guidelinesSectionOnboardLi2")}</li>
              <li>{t("business.dashboard.guidelinesSectionOnboardLi3")}</li>
            </ul>
          </section>

          <section className="border-l-[3px] border-l-border pl-4">
            <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
              <ShoppingBag className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              {t("business.dashboard.guidelinesSectionPrintTitle")}
            </h3>
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              <li>
                <Trans
                  i18nKey="business.dashboard.guidelinesSectionPrintLi1"
                  components={{
                    qrLink: <GuideLink to={`${QR_STUDIO_BASE}/print`} onNavigate={close} />,
                  }}
                />
              </li>
              {guideLine(t, "business.dashboard.guidelinesSectionPrintLi2") ? (
                <li>{t("business.dashboard.guidelinesSectionPrintLi2")}</li>
              ) : null}
              {guideLine(t, "business.dashboard.guidelinesSectionPrintLi3") ? (
                <li>{t("business.dashboard.guidelinesSectionPrintLi3")}</li>
              ) : null}
            </ul>
          </section>

          <section className="border-l-[3px] border-l-border pl-4">
            <h3 className="mb-2 flex items-center gap-2 text-base font-semibold">
              <TrendingUp className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              {t("business.dashboard.guidelinesSectionTipsTitle")}
            </h3>
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              <li>{t("business.dashboard.guidelinesSectionTipsLi1")}</li>
              {guideLine(t, "business.dashboard.guidelinesSectionTipsLi2") ? (
                <li>{t("business.dashboard.guidelinesSectionTipsLi2")}</li>
              ) : null}
              {guideLine(t, "business.dashboard.guidelinesSectionTipsLi3") ? (
                <li>{t("business.dashboard.guidelinesSectionTipsLi3")}</li>
              ) : null}
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
