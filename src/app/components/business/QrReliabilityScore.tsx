import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import type { QrBrandingOptions } from "../../lib/businessBranding";
import {
  isQrExportAllowed,
  validateBrandedQrReliability,
  type QrReliabilityReport,
} from "../../lib/qrBranded";
import type { QrQualityGrade } from "../../lib/qrReliability";
import { cn } from "@/lib/utils";
import { businessUi } from "@/app/components/business/businessDashboardUi";

const GRADE_STYLES: Record<
  QrQualityGrade,
  { icon: typeof CheckCircle2; badge: string; ring: string }
> = {
  excellent: {
    icon: Sparkles,
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-500/30",
  },
  good: {
    icon: CheckCircle2,
    badge: "bg-primary/10 text-primary",
    ring: "ring-primary/25",
  },
  risky: {
    icon: AlertTriangle,
    badge: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
    ring: "ring-amber-500/30",
  },
  unscannable: {
    icon: ShieldAlert,
    badge: "bg-destructive/15 text-destructive",
    ring: "ring-destructive/30",
  },
};

type QrReliabilityScoreProps = {
  sampleUrl: string;
  branding: Partial<QrBrandingOptions>;
  className?: string;
  /** Debounce ms for live re-validation. */
  debounceMs?: number;
  onReportChange?: (report: QrReliabilityReport | null) => void;
};

export function QrReliabilityScore({
  sampleUrl,
  branding,
  className,
  debounceMs = 400,
  onReportChange,
}: QrReliabilityScoreProps) {
  const { t } = useTranslation();
  const [report, setReport] = useState<QrReliabilityReport | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const brandingKey = useMemo(() => JSON.stringify(branding), [branding]);

  useEffect(() => {
    if (!sampleUrl.trim()) {
      setReport(null);
      setPreviewUrl("");
      onReportChange?.(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void validateBrandedQrReliability(sampleUrl, branding)
        .then(({ canvas, report: next }) => {
          if (cancelled) return;
          setReport(next);
          setPreviewUrl(canvas?.toDataURL("image/png") ?? "");
          onReportChange?.(next);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sampleUrl, brandingKey, debounceMs, onReportChange]);

  const grade = report?.grade ?? "good";
  const style = GRADE_STYLES[grade];
  const Icon = style.icon;

  return (
    <div className={cn(businessUi.cardStatic, "min-w-0 overflow-hidden", className)}>
      <div className="flex min-w-0 flex-col gap-4 border-b border-border/80 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("business.qrReliability.title")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {loading ? (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("business.qrReliability.validating")}
              </span>
            ) : (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                  style.badge,
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t(`business.qrReliability.grades.${grade}`)}
              </span>
            )}
            {report ? (
              <span className="text-xs text-muted-foreground">
                {t("business.qrReliability.contrast", {
                  ratio: report.contrastRatio.toFixed(1),
                })}
              </span>
            ) : null}
          </div>
        </div>
        {previewUrl ? (
          <div className="qr-studio-canvas-frame mx-auto w-full max-w-[8.5rem] shrink-0 sm:max-w-none sm:w-auto">
            <img
              src={previewUrl}
              alt=""
              className={cn(
                "mx-auto block h-auto max-h-28 w-full max-w-full object-contain rounded-lg border bg-white p-1 ring-2",
                style.ring,
              )}
            />
          </div>
        ) : null}
      </div>

      {report && report.warnings.length > 0 ? (
        <ul className="space-y-1.5 px-4 py-3 text-xs text-muted-foreground">
          {report.warnings.map((code) => (
            <li key={code} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              <span>{t(`business.qrReliability.warnings.${code}`)}</span>
            </li>
          ))}
        </ul>
      ) : report && isQrExportAllowed(report) ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">{t("business.qrReliability.passHint")}</p>
      ) : null}

      {report && !isQrExportAllowed(report) ? (
        <p className="border-t border-destructive/20 bg-destructive/5 px-4 py-3 text-xs font-medium text-destructive">
          {t("business.qrReliability.exportBlocked")}
        </p>
      ) : null}
    </div>
  );
}

export function QrQualityBadge({ grade }: { grade: QrQualityGrade }) {
  const { t } = useTranslation();
  const style = GRADE_STYLES[grade];
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        style.badge,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {t(`business.qrReliability.grades.${grade}`)}
    </span>
  );
}
