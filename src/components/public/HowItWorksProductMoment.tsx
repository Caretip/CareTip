import type { ReactNode } from "react";
import {
  Bell,
  Building2,
  Check,
  CreditCard,
  Mail,
  QrCode,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const frame =
  "relative overflow-hidden rounded-2xl border border-white/70 bg-[#fafaf8] shadow-[0_16px_48px_-20px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.04] dark:border-neutral-800 dark:bg-neutral-950";

const caption =
  "absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-neutral-950/75 via-neutral-950/30 to-transparent px-4 pb-3 pt-12";

type MomentShellProps = {
  label: string;
  className?: string;
  children: ReactNode;
  imageSrc?: string;
  imageClassName?: string;
};

function MomentShell({ label, className, children, imageSrc, imageClassName }: MomentShellProps) {
  return (
    <div className={cn("relative mx-auto w-full max-w-md lg:max-w-none", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-4 rounded-[1.75rem] bg-[radial-gradient(ellipse_at_50%_42%,rgba(233,120,28,0.12),transparent_72%)] blur-xl opacity-80"
      />
      <figure className={frame}>
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            className={cn("absolute inset-0 h-full w-full object-cover", imageClassName)}
            loading="lazy"
            decoding="async"
          />
        ) : null}
        <div className="relative aspect-[4/3] w-full">{children}</div>
        <figcaption className={caption}>
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/90 sm:text-[11px]">
            {label}
          </span>
        </figcaption>
      </figure>
    </div>
  );
}

export function AccountSetupMoment({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <MomentShell label={t("staticPages.howItWorks.visual.account")} className={className}>
      <div className="flex h-full flex-col justify-center gap-3 p-5 sm:p-6">
        <div className="rounded-xl border border-neutral-200/80 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-3 flex items-center gap-2">
            <div className="caretip-marketing-icon-chip flex h-8 w-8 items-center justify-center rounded-lg">
              <Building2 className="h-4 w-4" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
              {t("staticPages.howItWorks.mock.workspace")}
            </span>
          </div>
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
            {t("staticPages.howItWorks.mock.registerTitle")}
          </p>
          <div className="mt-3 space-y-2">
            <div className="h-9 rounded-lg bg-neutral-100 dark:bg-neutral-800" />
            <div className="h-9 rounded-lg bg-neutral-100 dark:bg-neutral-800" />
            <div className="flex h-10 items-center justify-center rounded-xl bg-primary text-xs font-bold text-white">
              {t("staticPages.howItWorks.mock.registerCta")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/25 bg-primary/[0.04] px-3 py-2">
          <Check className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-xs text-neutral-700 dark:text-neutral-300">{t("staticPages.howItWorks.mock.verifyHint")}</span>
        </div>
      </div>
    </MomentShell>
  );
}

export function TeamInviteMoment({ className, imageSrc }: { className?: string; imageSrc: string }) {
  const { t } = useTranslation();
  return (
    <MomentShell
      label={t("staticPages.howItWorks.visual.team")}
      className={className}
      imageSrc={imageSrc}
      imageClassName="opacity-25"
    >
      <div className="relative flex h-full items-center justify-center p-5">
        <div className="w-full max-w-[240px] rounded-xl border border-neutral-200/90 bg-white/95 p-4 shadow-[0_12px_40px_-16px_rgba(15,23,42,0.2)] backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/95">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              {t("staticPages.howItWorks.mock.inviteTitle")}
            </span>
          </div>
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
            <Mail className="h-3.5 w-3.5 text-neutral-500" />
            <span className="truncate text-xs text-neutral-600 dark:text-neutral-400">
              {t("staticPages.howItWorks.mock.inviteEmail")}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {t("staticPages.howItWorks.mock.roleServer")}
            </span>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              {t("staticPages.howItWorks.mock.roleBar")}
            </span>
          </div>
        </div>
      </div>
    </MomentShell>
  );
}

export function EmployeeTipMoment({ className, imageSrc }: { className?: string; imageSrc: string }) {
  const { t } = useTranslation();
  return (
    <MomentShell
      label={t("staticPages.howItWorks.visual.employeeTip")}
      className={className}
      imageSrc={imageSrc}
      imageClassName="object-[center_20%] opacity-35"
    >
      <div className="relative flex h-full flex-col justify-between p-4 sm:p-5">
        <div className="ml-auto max-w-[88%] rounded-2xl border border-neutral-200/80 bg-white p-3 shadow-[0_8px_28px_-8px_rgba(15,23,42,0.15)] dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-start gap-2.5">
            <div className="caretip-marketing-icon-chip flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
              <Bell className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-neutral-900 dark:text-neutral-50">
                {t("staticPages.howItWorks.mock.tipReceivedTitle")}
              </p>
              <p className="text-xl font-bold tabular-nums tracking-tight text-primary">
                {t("staticPages.howItWorks.mock.tipAmount")}
              </p>
              <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
                {t("staticPages.howItWorks.mock.tipReceivedSub")}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-neutral-200/70 bg-white/95 p-3 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90">
          <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-neutral-500">
            {t("staticPages.howItWorks.mock.earningsToday")}
          </p>
          <p className="text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-50">
            {t("staticPages.howItWorks.mock.earningsValue")}
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600">
            <TrendingUp className="h-3 w-3" />
            {t("staticPages.howItWorks.mock.earningsDelta")}
          </div>
        </div>
      </div>
    </MomentShell>
  );
}

export function PayoutMoment({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <MomentShell label={t("staticPages.howItWorks.visual.payout")} className={className}>
      <div className="flex h-full flex-col justify-center gap-3 p-5 sm:p-6">
        <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/80 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/40">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15">
              <Check className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                {t("staticPages.howItWorks.mock.payoutSuccess")}
              </p>
              <p className="text-xs text-neutral-600 dark:text-neutral-400">{t("staticPages.howItWorks.mock.payoutSub")}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-neutral-200/80 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                {t("staticPages.howItWorks.mock.withdrawLabel")}
              </span>
            </div>
            <span className="text-sm font-bold tabular-nums text-neutral-900 dark:text-neutral-50">
              {t("staticPages.howItWorks.mock.withdrawAmount")}
            </span>
          </div>
          <div className="mt-3 h-9 rounded-lg bg-primary text-center text-xs font-bold leading-9 text-white">
            {t("staticPages.howItWorks.mock.withdrawCta")}
          </div>
        </div>
      </div>
    </MomentShell>
  );
}

export function ManagerAnalyticsMoment({ className, imageSrc }: { className?: string; imageSrc: string }) {
  const { t } = useTranslation();
  return (
    <MomentShell
      label={t("staticPages.howItWorks.visual.analytics")}
      className={className}
      imageSrc={imageSrc}
      imageClassName="opacity-40"
    >
      <div className="relative flex h-full flex-col justify-end gap-2 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-white/80 bg-white/95 p-2.5 shadow-sm backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/95">
            <p className="text-[10px] text-neutral-500">{t("staticPages.howItWorks.mock.metricTips")}</p>
            <p className="text-base font-bold tabular-nums text-neutral-900 dark:text-neutral-50">248</p>
          </div>
          <div className="rounded-lg border border-white/80 bg-white/95 p-2.5 shadow-sm backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/95">
            <p className="text-[10px] text-neutral-500">{t("staticPages.howItWorks.mock.metricTop")}</p>
            <p className="truncate text-xs font-semibold text-neutral-900 dark:text-neutral-50">
              {t("staticPages.howItWorks.mock.metricTopName")}
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-white/80 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/95">
          <p className="text-[10px] font-medium text-neutral-500">{t("staticPages.howItWorks.mock.activityFeed")}</p>
          <p className="text-xs text-neutral-800 dark:text-neutral-200">{t("staticPages.howItWorks.mock.activityLine")}</p>
        </div>
      </div>
    </MomentShell>
  );
}

export function GrowthMoment({ className, imageSrc }: { className?: string; imageSrc: string }) {
  const { t } = useTranslation();
  return (
    <MomentShell
      label={t("staticPages.howItWorks.visual.growth")}
      className={className}
      imageSrc={imageSrc}
      imageClassName="object-center"
    >
      <div className="absolute inset-0 bg-gradient-to-t from-neutral-950/55 via-transparent to-transparent" aria-hidden />
      <div className="relative flex h-full flex-col justify-end gap-2 p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 shadow-sm">
            <TrendingUp className="h-3 w-3" />
            {t("staticPages.howItWorks.mock.growthBadge")}
          </span>
          <span className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-neutral-800 shadow-sm">
            {t("staticPages.howItWorks.mock.growthEngagement")}
          </span>
        </div>
      </div>
    </MomentShell>
  );
}

export function ImageMoment({
  className,
  imageSrc,
  labelKey,
  objectPosition = "center",
}: {
  className?: string;
  imageSrc: string;
  labelKey: string;
  objectPosition?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("relative mx-auto w-full max-w-md lg:max-w-none", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-4 rounded-[1.75rem] bg-[radial-gradient(ellipse_at_50%_42%,rgba(233,120,28,0.12),transparent_72%)] blur-xl opacity-80"
      />
      <figure className={frame}>
        <img
          src={imageSrc}
          alt=""
          className="block aspect-[4/3] w-full object-cover"
          style={{ objectPosition }}
          loading="lazy"
          decoding="async"
        />
        <figcaption className={caption}>
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/90 sm:text-[11px]">
            {t(labelKey)}
          </span>
        </figcaption>
      </figure>
    </div>
  );
}

export function CustomerTipMoment({ className, imageSrc }: { className?: string; imageSrc: string }) {
  const { t } = useTranslation();
  return (
    <MomentShell
      label={t("staticPages.howItWorks.visual.customerTip")}
      className={className}
      imageSrc={imageSrc}
      imageClassName="opacity-50"
    >
      <div className="relative flex h-full items-end justify-center p-4 pb-14">
        <div className="w-full max-w-[200px] rounded-2xl border border-neutral-200/90 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-2 flex justify-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15">
              <Check className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
          <p className="text-center text-xs font-semibold text-neutral-900 dark:text-neutral-50">
            {t("staticPages.howItWorks.mock.paymentSuccess")}
          </p>
          <p className="text-center text-lg font-bold text-primary">{t("staticPages.howItWorks.mock.tipPaid")}</p>
          <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-neutral-500">
            <CreditCard className="h-3 w-3" />
            {t("staticPages.howItWorks.mock.paymentMethod")}
          </div>
        </div>
      </div>
    </MomentShell>
  );
}

export function QrGenerateMoment({ className, imageSrc }: { className?: string; imageSrc: string }) {
  const { t } = useTranslation();
  return (
    <MomentShell
      label={t("staticPages.howItWorks.visual.qrGenerate")}
      className={className}
      imageSrc={imageSrc}
      imageClassName="opacity-20"
    >
      <div className="relative flex h-full items-center justify-center gap-3 p-5">
        <div className="rounded-xl border border-neutral-200/90 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <QrCode className="mx-auto h-16 w-16 text-neutral-800 dark:text-neutral-200" strokeWidth={1.25} />
          <p className="mt-2 text-center text-[10px] font-semibold text-neutral-700 dark:text-neutral-300">
            {t("staticPages.howItWorks.mock.qrTable")}
          </p>
        </div>
        <div className="hidden w-[42%] rounded-xl border border-neutral-200/90 bg-white p-2 shadow-md sm:block dark:border-neutral-700 dark:bg-neutral-900">
          <UserPlus className="mb-1 h-4 w-4 text-primary" />
          <p className="text-[10px] font-semibold text-neutral-800 dark:text-neutral-200">
            {t("staticPages.howItWorks.mock.qrStaff")}
          </p>
        </div>
      </div>
    </MomentShell>
  );
}
