import { cn } from "@/lib/utils";
import { caretipBtnPrimaryFull } from "@/lib/caretipButtonSystem";
import { formatEur } from "@/app/lib/formatEur";
import { CheckCircle2, QrCode, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

const HERO_PREVIEW_AMOUNTS = {
  todayTips: 127.5,
  tipSent: 20,
  teamDeltas: [12, 8, 6] as const,
} as const;

type Props = {
  className?: string;
};

/**
 * Product-relevant hero preview:
 * - Phone mock with QR + "Scan to tip"
 * - Tip confirmation UI
 * - Simple earnings/tips summary
 *
 * No heavy assets; only CSS-based ambient/fade/float/glow.
 */
export function BusinessDashboardHeroProductPreview({ className }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "relative isolate w-full overflow-hidden rounded-xl bg-neutral-950",
        "ring-1 ring-white/10 shadow-[0_18px_55px_rgba(0,0,0,0.40)]",
        "caretip-hero-fadein caretip-hero-float",
        className,
      )}
    >
      <div className="caretip-hero-ambient pointer-events-none absolute inset-0 z-[0]" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(700px circle at 18% 28%, rgba(235,153,44,0.18), transparent 56%), radial-gradient(900px circle at 78% 62%, rgba(235,153,44,0.10), transparent 62%), linear-gradient(to top, rgba(0,0,0,0.62), rgba(0,0,0,0.0) 60%)",
        }}
        aria-hidden
      />

      <div className="relative z-[2] grid w-full grid-cols-12 gap-4 p-4 sm:gap-5 sm:p-5">
        {/* Left: phone mock */}
        <div className="col-span-12 sm:col-span-6">
          <div className="mx-auto w-full max-w-[420px]">
            <div className="relative rounded-[28px] border border-white/10 bg-black/35 p-3 shadow-[0_30px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl">
              <div className="absolute left-1/2 top-2 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/10" aria-hidden />
              <div className="rounded-[22px] bg-gradient-to-b from-neutral-900 to-neutral-950 ring-1 ring-white/10 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-xl bg-primary/15 ring-1 ring-primary/30 grid place-items-center">
                      <QrCode className="h-4 w-4 text-primary" aria-hidden />
                    </div>
                    <div className="leading-tight">
                      <p className="text-[11px] font-semibold text-white">{t("business.heroPreview.scanToTip")}</p>
                      <p className="text-[10px] text-white/60">{t("business.heroPreview.careTipQr")}</p>
                    </div>
                  </div>
                  <div className="h-7 w-16 rounded-full bg-white/5 ring-1 ring-white/10" aria-hidden />
                </div>

                {/* QR card */}
                <div className="px-4 pb-4">
                  <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-white/85">{t("business.heroPreview.tableLabel")}</p>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-600 ring-1 ring-emerald-500/25 dark:text-emerald-400">
                        {t("status.live")}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-12 gap-3 items-center">
                      <div className="col-span-6">
                        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black/50 ring-1 ring-primary/30">
                          <div className="caretip-qr-glow absolute inset-0" aria-hidden />
                          <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full p-2">
                            <rect width="64" height="64" fill="none" />
                            <g fill="rgba(235,153,44,0.92)">
                              <rect x="6" y="6" width="16" height="16" rx="3" />
                              <rect x="42" y="6" width="16" height="16" rx="3" />
                              <rect x="6" y="42" width="16" height="16" rx="3" />
                              {[
                                [28, 10],
                                [32, 14],
                                [24, 18],
                                [34, 24],
                                [22, 26],
                                [30, 30],
                                [38, 28],
                                [28, 36],
                                [34, 40],
                                [24, 34],
                                [40, 42],
                                [30, 46],
                              ].map(([x, y], i) => (
                                <rect key={i} x={x} y={y} width="4" height="4" rx="1" />
                              ))}
                            </g>
                          </svg>
                        </div>
                      </div>

                      <div className="col-span-6 space-y-2">
                        <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                          <p className="text-[10px] font-semibold text-white/70">{t("business.heroPreview.today")}</p>
                          <p className="mt-0.5 text-base font-bold text-white">+{formatEur(HERO_PREVIEW_AMOUNTS.todayTips)}</p>
                          <p className="text-[10px] text-white/55">{t("business.heroPreview.tipsReceived")}</p>
                        </div>
                        <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                          <p className="text-[10px] font-semibold text-white/70">{t("business.heroPreview.scans")}</p>
                          <p className="mt-0.5 text-base font-bold text-white">38</p>
                          <p className="text-[10px] text-white/55">{t("business.heroPreview.last24h")}</p>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      className={cn(caretipBtnPrimaryFull, "mt-4")}
                    >
                      {t("business.heroPreview.shareQr")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: tip confirmation + team chips */}
        <div className="col-span-12 sm:col-span-6">
          <div className="mx-auto w-full max-w-[520px] space-y-4 sm:pt-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_26px_70px_rgba(0,0,0,0.50)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-white/65">{t("business.heroPreview.paymentConfirmation")}</p>
                  <p className="mt-1 text-base font-bold text-white">{t("business.heroPreview.tipSentSuccess")}</p>
                  <p className="mt-1 text-xs text-white/55">{t("business.heroPreview.tipSentSub")}</p>
                </div>
                <div className="shrink-0 rounded-2xl bg-primary/15 p-2.5 ring-1 ring-primary/25">
                  <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-black/30 ring-1 ring-white/10 p-3">
                  <p className="text-[10px] font-semibold text-white/65">{t("business.heroPreview.amount")}</p>
                  <p className="mt-1 text-lg font-bold text-white">{formatEur(HERO_PREVIEW_AMOUNTS.tipSent)}</p>
                </div>
                <div className="rounded-xl bg-black/30 ring-1 ring-white/10 p-3">
                  <p className="text-[10px] font-semibold text-white/65">{t("business.heroPreview.teamMember")}</p>
                  <p className="mt-1 text-sm font-semibold text-white">Anna · Floor</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">{t("business.heroPreview.teamPulse")}</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/25">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                  {t("status.live")}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  { name: "Sam", delta: HERO_PREVIEW_AMOUNTS.teamDeltas[0] },
                  { name: "Jordan", delta: HERO_PREVIEW_AMOUNTS.teamDeltas[1] },
                  { name: "Mina", delta: HERO_PREVIEW_AMOUNTS.teamDeltas[2] },
                ].map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center gap-2 rounded-full bg-black/30 px-3 py-2 ring-1 ring-white/10"
                  >
                    <div className="h-7 w-7 rounded-full bg-primary/20 ring-1 ring-primary/30" aria-hidden />
                    <div className="leading-tight">
                      <p className="text-[11px] font-semibold text-white">{p.name}</p>
                      <p className="text-[10px] font-semibold text-primary">+{formatEur(p.delta)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[11px] leading-snug text-white/55">{t("business.heroPreview.previewFoot")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

