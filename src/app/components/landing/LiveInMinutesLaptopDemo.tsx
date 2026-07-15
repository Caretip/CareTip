import * as React from "react";
import { Check, QrCode, Sparkles, UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useMinWidthMedia } from "@/lib/motionPerf";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { landingCopyVisible } from "@/components/landing/landingUi";
import { LandingReveal } from "@/components/landing/LandingReveal";
import caretipLogo from "@/assets/brand/CareTip_Primary.svg";
import { LiveInMinutesOnboardingPhone } from "@/app/components/landing/LiveInMinutesOnboardingPhone";

export const LIVE_DEMO_SLIDE_IDS = ["signup", "team", "qr", "dashboard"] as const;
export type LiveDemoSlideId = (typeof LIVE_DEMO_SLIDE_IDS)[number];

/** Matches SimpleSetupSection step buttons: account → team → QR → tips */
export const SETUP_JOURNEY_STEP_COUNT = 4;

const PROGRESS_ITEM_KEYS = [
  "progressAccount",
  "progressTeam",
  "progressQr",
  "progressReceiving",
] as const;

const SETUP_STEP_TITLE_KEYS = [
  "step1Title",
  "step2Title",
  "step3Title",
  "step4Title",
] as const;

const NEXT_STEP_TITLE_KEYS = [
  "step2Title",
  "step3Title",
  "step4Title",
] as const;

type ProgressStatus = "complete" | "active" | "pending";

type LiveInMinutesLaptopDemoProps = {
  videoSrc?: string;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
};

function progressStatus(itemIndex: number, activeIndex: number): ProgressStatus {
  if (itemIndex < activeIndex) return "complete";
  if (itemIndex === activeIndex) return "active";
  return "pending";
}

export function LiveInMinutesLaptopDemo({
  videoSrc,
  activeIndex = 0,
}: LiveInMinutesLaptopDemoProps) {
  const { t, i18n } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();
  const isLgUp = useMinWidthMedia(1024);
  const index = Math.min(Math.max(0, activeIndex), SETUP_JOURNEY_STEP_COUNT - 1);

  const captions = React.useMemo(
    () => [
      t("landing.simpleSetup.visualCaption1"),
      t("landing.simpleSetup.visualCaption2"),
      t("landing.simpleSetup.visualCaption3"),
      t("landing.simpleSetup.visualCaption4"),
    ],
    [t, i18n.language],
  );

  const caption = captions[index];

  if (videoSrc) {
    return (
      <LandingReveal className="caretip-live-minutes-stage caretip-live-minutes-device-lift relative mx-auto w-full max-w-[min(100%,15.75rem)] overflow-hidden rounded-[1.35rem] shadow-[0_20px_40px_-24px_rgba(30,24,16,0.26),0_8px_18px_-10px_rgba(30,24,16,0.12)] ring-1 ring-neutral-900/[0.06] sm:max-w-[20rem] sm:rounded-[1.5rem] lg:max-w-[22rem] dark:ring-white/[0.08]">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="aspect-[6/5] w-full object-cover sm:aspect-[3/4]"
          src={videoSrc}
        />
      </LandingReveal>
    );
  }

  return (
    <div className="caretip-live-minutes-stage caretip-live-minutes-stage--onboarding relative mx-auto w-full max-w-[min(100%,18rem)] sm:max-w-[20rem]">
      <div className="caretip-live-minutes-onboarding-preview">
        <LandingReveal className="caretip-live-minutes-onboarding-slot relative flex items-center justify-center">
          <LiveInMinutesOnboardingPhone
            activeIndex={index}
            language={i18n.language}
            reduceMotion={reduceMotion}
            caption={caption}
            demoAriaLabel={t("landing.liveDemo.demoAria", {
              label: landingCopyVisible(caption)
                ? caption
                : t(`landing.simpleSetup.${SETUP_STEP_TITLE_KEYS[index]}`),
            })}
            fallback={
              <PhoneFrame compact={!isLgUp}>
                <PhoneStepScreen activeIndex={index} />
              </PhoneFrame>
            }
          />
        </LandingReveal>

        {landingCopyVisible(caption) ? (
          <p className="caretip-live-minutes-caption mt-1 font-sans text-[12px] leading-snug tracking-tight text-neutral-600 dark:text-neutral-400 sm:mt-1.5 sm:text-[13px] lg:text-sm">
            {caption}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** One screen per setup step — aligned with SimpleSetupSection list order */
function PhoneStepScreen({ activeIndex }: { activeIndex: number }) {
  switch (activeIndex) {
    case 0:
      return <AccountStepPhone activeIndex={activeIndex} />;
    case 1:
      return <TeamStepPhone activeIndex={activeIndex} />;
    case 2:
      return <QrStepPhone activeIndex={activeIndex} />;
    case 3:
      return <TipsStepPhone activeIndex={activeIndex} />;
    default:
      return <AccountStepPhone activeIndex={0} />;
  }
}

function PhoneStepShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[11.25rem] flex-col px-2.5 pb-2.5 pt-3 sm:px-3 sm:pb-3 sm:pt-3.5">
      {children}
    </div>
  );
}

function PhoneStepHeader() {
  const { t } = useTranslation();
  return (
    <div className="mb-2.5 flex items-center gap-2 border-b border-neutral-200/80 pb-2 dark:border-neutral-700/80">
      <img src={caretipLogo} alt="" className="h-5 w-auto shrink-0 opacity-90" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-[10px] font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {t("landing.simpleSetup.progressTitle")}
        </p>
      </div>
    </div>
  );
}

function AccountStepPhone({ activeIndex }: { activeIndex: number }) {
  return (
    <OnboardingProgressScreen
      activeIndex={activeIndex}
      allComplete={false}
      highlightTitleKey="phoneWelcome"
      highlightSubKey="phoneWelcomeSub"
      showSecureTrust
      headerIcon={<UserPlus className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />}
    />
  );
}

function TeamStepPhone({ activeIndex }: { activeIndex: number }) {
  const { t } = useTranslation();
  return (
    <PhoneStepShell>
      <PhoneStepHeader />
      <div className="mb-2 text-center">
        <p className="font-sans text-[11px] font-bold text-neutral-900 dark:text-neutral-50">
          {t("landing.simpleSetup.phoneTeam")}
        </p>
        <p className="mt-0.5 text-[9px] text-neutral-500 dark:text-neutral-400">
          {t("landing.simpleSetup.phoneTeamSub")}
        </p>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-2">
        <div className="flex justify-center -space-x-2">
          {["A", "B", "C"].map((initial, i) => (
            <span
              key={initial}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold shadow-sm dark:border-neutral-900",
                i === 1 ? "bg-primary text-white" : "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100",
              )}
              aria-hidden
            >
              {initial}
            </span>
          ))}
        </div>
        <p className="text-center text-[9px] font-semibold text-primary">{t("landing.simpleSetup.badgeStaff")}</p>
      </div>
      <ProgressChecklistFooter activeIndex={activeIndex} allComplete={false} />
    </PhoneStepShell>
  );
}

function QrStepPhone({ activeIndex }: { activeIndex: number }) {
  const { t } = useTranslation();
  return (
    <PhoneStepShell>
      <PhoneStepHeader />
      <div className="mb-2 text-center">
        <p className="font-sans text-[11px] font-bold text-neutral-900 dark:text-neutral-50">
          {t("landing.simpleSetup.phoneQr")}
        </p>
        <p className="mt-0.5 text-[9px] text-neutral-500 dark:text-neutral-400">
          {t("landing.simpleSetup.phoneQrSub")}
        </p>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-dashed border-primary/35 bg-primary/[0.06] shadow-inner">
          <QrCode className="h-9 w-9 text-primary/85" strokeWidth={1.5} aria-hidden />
        </div>
        <p className="text-[9px] font-semibold text-primary">{t("landing.simpleSetup.badgeQr")}</p>
      </div>
      <ProgressChecklistFooter activeIndex={activeIndex} allComplete={false} />
    </PhoneStepShell>
  );
}

function TipsStepPhone({ activeIndex }: { activeIndex: number }) {
  const { t } = useTranslation();
  return (
    <PhoneStepShell>
      <PhoneStepHeader />
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-1">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Sparkles className="h-5 w-5" aria-hidden />
        </span>
        <p className="font-sans text-[11px] font-bold text-neutral-900 dark:text-neutral-50">
          {t("landing.simpleSetup.phoneCelebrate")}
        </p>
        <p className="text-[9px] text-neutral-500 dark:text-neutral-400">
          {t("landing.simpleSetup.phoneCelebrateSub")}
        </p>
        <p className="mt-1 font-sans text-lg font-bold tabular-nums tracking-tight text-primary">€12.00</p>
      </div>
      <ProgressChecklistFooter activeIndex={activeIndex} allComplete />
    </PhoneStepShell>
  );
}

function ProgressChecklistFooter({
  activeIndex,
  allComplete,
}: {
  activeIndex: number;
  allComplete: boolean;
}) {
  const { t } = useTranslation();
  const nextKey = NEXT_STEP_TITLE_KEYS[activeIndex];

  return (
    <div
      className={cn(
        "mt-2 rounded-lg px-2 py-1.5 text-center transition-colors duration-300",
        allComplete
          ? "bg-primary/12 ring-1 ring-primary/20"
          : "bg-neutral-100/90 ring-1 ring-neutral-200/80 dark:bg-neutral-800/80 dark:ring-neutral-700/80",
      )}
    >
      <p
        className={cn(
          "font-sans text-[9px] font-semibold leading-tight sm:text-[10px]",
          allComplete ? "text-primary" : "text-neutral-600 dark:text-neutral-400",
        )}
      >
        {allComplete ? (
          <span className="inline-flex items-center justify-center gap-1">
            <Sparkles className="h-2.5 w-2.5" aria-hidden />
            {t("landing.simpleSetup.progressReadyForTips")}
          </span>
        ) : nextKey ? (
          t("landing.simpleSetup.progressUpNext", { step: t(`landing.simpleSetup.${nextKey}`) })
        ) : null}
      </p>
    </div>
  );
}

function OnboardingProgressScreen({
  activeIndex,
  allComplete,
  highlightTitleKey,
  highlightSubKey,
  showSecureTrust = false,
  headerIcon,
}: {
  activeIndex: number;
  allComplete: boolean;
  highlightTitleKey?: "phoneWelcome";
  highlightSubKey?: "phoneWelcomeSub";
  showSecureTrust?: boolean;
  headerIcon?: React.ReactNode;
}) {
  const { t } = useTranslation();

  const icons = [UserPlus, Users, QrCode, Sparkles] as const;
  const completedCount = allComplete ? SETUP_JOURNEY_STEP_COUNT : activeIndex + 1;

  return (
    <PhoneStepShell>
      <div className="mb-2 flex items-center gap-2 border-b border-neutral-200/80 pb-2 dark:border-neutral-700/80">
        <img src={caretipLogo} alt="" className="h-5 w-auto shrink-0 opacity-90" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-sans text-[10px] font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            {highlightTitleKey ? t(`landing.simpleSetup.${highlightTitleKey}`) : t("landing.simpleSetup.progressTitle")}
          </p>
          <p className="text-[8px] font-medium text-neutral-500 dark:text-neutral-400">
            {highlightSubKey
              ? t(`landing.simpleSetup.${highlightSubKey}`)
              : t("landing.simpleSetup.progressStepOf", {
                  current: completedCount,
                  total: SETUP_JOURNEY_STEP_COUNT,
                })}
          </p>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-1.5" role="list">
        {PROGRESS_ITEM_KEYS.map((labelKey, itemIndex) => {
          const status = allComplete ? "complete" : progressStatus(itemIndex, activeIndex);
          const Icon = icons[itemIndex];
          return (
            <li key={labelKey} role="listitem">
              <ProgressRow
                label={t(`landing.simpleSetup.${labelKey}`)}
                status={status}
                icon={headerIcon && itemIndex === 0 ? headerIcon : <Icon className="h-3 w-3" strokeWidth={2.25} aria-hidden />}
              />
            </li>
          );
        })}
      </ul>

      {showSecureTrust ? (
        <div className="mt-2 rounded-lg border border-primary/15 bg-primary/[0.05] px-2 py-1.5 text-center">
          <p className="text-[8px] font-semibold text-neutral-900 dark:text-neutral-50">
            {t("landing.simpleSetup.phoneSecureTitle")}
          </p>
          <p className="mt-0.5 text-[7px] leading-snug text-neutral-600 dark:text-neutral-400">
            {t("landing.simpleSetup.phoneSecureBody")}
          </p>
        </div>
      ) : null}

      <ProgressChecklistFooter activeIndex={activeIndex} allComplete={allComplete} />
    </PhoneStepShell>
  );
}

function PhoneFrame({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  return (
    <div
      className={cn(
        "relative z-[1] w-full",
        compact ? "max-w-[min(100%,12.75rem)]" : "h-full max-w-[10.25rem] sm:max-w-[11.25rem] lg:max-w-[13.5rem] xl:max-w-[14.25rem]",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-0.5 left-1/2 z-0 h-3 w-[90%] -translate-x-1/2 rounded-[100%] bg-neutral-900/20 blur-sm"
      />
      <div
        className={cn(
          "relative z-[1] rounded-[1.35rem] bg-neutral-900/92 p-[2.5px] shadow-[0_14px_32px_-12px_rgba(0,0,0,0.45)] ring-1 ring-white/10 sm:rounded-[1.5rem] sm:p-[3px]",
          compact ? "w-full" : "h-full",
        )}
      >
        <span
          aria-hidden
          className="absolute left-1/2 top-1 z-10 h-[2.5px] w-8 -translate-x-1/2 rounded-full bg-neutral-700 sm:top-1.5 sm:w-10"
        />
        <div
          className={cn(
            "overflow-hidden rounded-[1.2rem] bg-[linear-gradient(180deg,#fffdf9_0%,#f8f4ee_100%)] sm:rounded-[1.45rem]",
            compact ? "min-h-[11.25rem]" : "h-full",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function ProgressRow({
  label,
  status,
  icon,
}: {
  label: string;
  status: ProgressStatus;
  icon: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-300",
        status === "complete" && "bg-primary/[0.07]",
        status === "active" && "bg-primary/10 ring-1 ring-primary/25",
        status === "pending" && "bg-neutral-50/80 dark:bg-neutral-900/40",
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
          status === "complete" && "bg-primary text-white",
          status === "active" && "bg-primary/15 text-primary",
          status === "pending" && "bg-neutral-200/80 text-neutral-400 dark:bg-neutral-700 dark:text-neutral-500",
        )}
      >
        {status === "complete" ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> : icon}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-left text-[9px] font-semibold leading-tight sm:text-[10px]",
          status === "complete" && "text-neutral-800 dark:text-neutral-100",
          status === "active" && "text-neutral-900 dark:text-neutral-50",
          status === "pending" && "text-neutral-500 dark:text-neutral-500",
        )}
      >
        {label}
      </span>
      {status === "active" ? (
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
      ) : null}
    </div>
  );
}
