import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Users, Printer, TrendingUp } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

/** Palette 84 — CareTip brand accents */
const P = {
  teal: "#e9781c",
  deep: "#111827",
  sage: "#F9FAFB",
  gray: "#6B7280",
  tomato: "#e9781c",
} as const;

interface CareTipUsageGuidelinesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CareTipUsageGuidelinesDialog({
  open,
  onOpenChange,
}: CareTipUsageGuidelinesDialogProps) {
  const { t } = useTranslation();
  const highlight = <strong style={{ color: P.deep }} />;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto border-2" style={{ borderColor: P.teal }}>
        <DialogHeader>
          <DialogTitle className="text-xl" style={{ color: P.deep }}>
            {t("business.dashboard.guidelinesDialogTitle")}
          </DialogTitle>
          <DialogDescription className="text-left" style={{ color: P.gray }}>
            {t("business.dashboard.guidelinesDialogDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-8 pt-2 text-sm text-foreground">
          <section
            className="rounded-xl border-l-4 p-4"
            style={{ borderLeftColor: P.teal, backgroundColor: `${P.sage}18` }}
          >
            <h3 className="flex items-center gap-2 font-semibold text-base mb-2" style={{ color: P.deep }}>
              <Users className="h-5 w-5 shrink-0" style={{ color: P.teal }} />
              {t("business.dashboard.guidelinesSectionOnboardTitle")}
            </h3>
            <ul className="list-disc pl-5 space-y-2" style={{ color: P.gray }}>
              <li>
                <Trans
                  i18nKey="business.dashboard.guidelinesSectionOnboardLi1"
                  components={{ highlight }}
                />
              </li>
              <li>{t("business.dashboard.guidelinesSectionOnboardLi2")}</li>
              <li>{t("business.dashboard.guidelinesSectionOnboardLi3")}</li>
            </ul>
          </section>

          <section
            className="rounded-xl border-l-4 p-4"
            style={{ borderLeftColor: P.tomato, backgroundColor: `${P.teal}10` }}
          >
            <h3 className="flex items-center gap-2 font-semibold text-base mb-2" style={{ color: P.deep }}>
              <Printer className="h-5 w-5 shrink-0" style={{ color: P.tomato }} />
              {t("business.dashboard.guidelinesSectionPrintTitle")}
            </h3>
            <ul className="list-disc pl-5 space-y-2" style={{ color: P.gray }}>
              <li>
                <Trans
                  i18nKey="business.dashboard.guidelinesSectionPrintLi1"
                  components={{ highlight }}
                />
              </li>
              <li>{t("business.dashboard.guidelinesSectionPrintLi2")}</li>
              <li>{t("business.dashboard.guidelinesSectionPrintLi3")}</li>
            </ul>
          </section>

          <section
            className="rounded-xl border-l-4 p-4"
            style={{ borderLeftColor: P.sage, backgroundColor: `${P.tomato}0D` }}
          >
            <h3 className="flex items-center gap-2 font-semibold text-base mb-2" style={{ color: P.deep }}>
              <TrendingUp className="h-5 w-5 shrink-0" style={{ color: P.teal }} />
              {t("business.dashboard.guidelinesSectionTipsTitle")}
            </h3>
            <ul className="list-disc pl-5 space-y-2" style={{ color: P.gray }}>
              <li>{t("business.dashboard.guidelinesSectionTipsLi1")}</li>
              <li>{t("business.dashboard.guidelinesSectionTipsLi2")}</li>
              <li>{t("business.dashboard.guidelinesSectionTipsLi3")}</li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
