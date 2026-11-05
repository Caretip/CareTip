import * as React from "react";
import { Lock, ShieldCheck, Wifi } from "lucide-react";
import { motion, useMotionValue, useTransform } from "motion/react";

import { cn } from "@/lib/utils";

const PERSPECTIVE = 1000;
const CARD_ANIMATION_DURATION = 0.6;
const INITIAL_DELAY = 0.2;

/** Realistic EMV chip — decorative only, not a payment credential. */
function EmvChip({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative h-8 w-10 overflow-hidden rounded-[5px] ring-1 ring-black/40 sm:h-9 sm:w-11 sm:rounded-[6px]",
        className,
      )}
      aria-hidden
    >
      <div className="absolute inset-0 bg-[#b8942e]" />
      <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.22)_0%,transparent_42%,rgba(0,0,0,0.18)_100%)]" />
      <div className="absolute inset-[3px] rounded-[3px] border border-[#8a6f1f]/50 sm:inset-[3.5px]">
        <div className="absolute left-[22%] top-0 h-full w-px bg-[#7a6218]/55" />
        <div className="absolute left-[48%] top-0 h-full w-px bg-[#7a6218]/55" />
        <div className="absolute left-[72%] top-0 h-full w-px bg-[#7a6218]/55" />
        <div className="absolute left-0 top-[32%] h-px w-full bg-[#7a6218]/55" />
        <div className="absolute left-0 top-[66%] h-px w-full bg-[#7a6218]/55" />
      </div>
    </div>
  );
}

function ContactlessMark({ className }: { className?: string }) {
  return (
    <Wifi
      className={cn("size-5 rotate-90 text-white/70 sm:size-[1.35rem]", className)}
      strokeWidth={1.75}
      aria-hidden
    />
  );
}

export interface InteractiveCreditCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** @deprecated Legacy demo variants only */
  cardNumber?: string;
  /** @deprecated Legacy demo variants only */
  cardHolder?: string;
  /** @deprecated Legacy demo variants only */
  expiryDate?: string;
  /** @deprecated Legacy demo variants only */
  cvv?: string;
  variant?: "gradient" | "dark" | "glass" | "caretip";
  /** CareTip front — small label above wordmark */
  frontEyebrow?: string;
  /** CareTip front — primary brand line */
  frontTitle?: string;
  /** CareTip front — supporting caption */
  frontCaption?: string;
  /** CareTip back — section heading */
  backTitle?: string;
  backLine1?: string;
  backLine2?: string;
  backBullet1?: string;
  backBullet2?: string;
  backDisclaimer?: string;
  footerNote?: string;
  /** Disable tilt interaction (recommended on touch). */
  disableTilt?: boolean;
}

export function InteractiveCreditCard({
  cardNumber = "4532 1234 5678 9010",
  cardHolder = "CARETIP GUEST",
  expiryDate = "12/28",
  cvv = "123",
  variant = "caretip",
  frontEyebrow = "Secure checkout",
  frontTitle = "CareTip",
  frontCaption = "Digital tipping · Stripe encrypted",
  backTitle = "Processor-secured",
  backLine1 = "Payments processed by Stripe.",
  backLine2 = "Card details are never stored by CareTip.",
  backBullet1 = "Stripe Checkout · Apple Pay · Google Pay",
  backBullet2 = "CareTip routes tips, never stores card data",
  backDisclaimer = "Not a bank-issued card · payment visualization",
  footerNote = "Illustration only",
  disableTilt = false,
  className,
  ...props
}: InteractiveCreditCardProps) {
  const [isFlipped, setIsFlipped] = React.useState(false);
  const [isClicked, setIsClicked] = React.useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, [-100, 100], [6, -6]);
  const rotateYMotion = useTransform(x, [-100, 100], [-6, 6]);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (disableTilt || prefersReducedMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set(event.clientX - centerX);
    y.set(event.clientY - centerY);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  const flipCard = () => {
    setIsClicked(true);
    window.setTimeout(() => setIsClicked(false), 200);
    window.setTimeout(() => setIsFlipped((prev) => !prev), 100);
  };

  const variantStyles = {
    gradient: "bg-gradient-to-br from-violet-600 via-purple-600 to-pink-600",
    dark: "bg-gradient-to-br from-gray-800 via-gray-700 to-gray-900",
    glass: "border border-white/20 bg-white/15 backdrop-blur-xl dark:bg-white/10",
    caretip:
      "border border-white/20 bg-gradient-to-br from-[#c2410c] via-[#eb992c] to-[#f59e0b] shadow-[0_24px_56px_-18px_rgba(0,0,0,0.32),0_20px_48px_-20px_rgba(235,153,44,0.4),inset_0_1px_0_rgba(255,255,255,0.26),inset_0_-12px_24px_-8px_rgba(0,0,0,0.18)]",
  };

  const caretipCardBackdrop = (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-[#c2410c] via-[#eb992c] to-[#f59e0b]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,255,255,0.14),transparent_55%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_100%_100%,rgba(0,0,0,0.22),transparent_52%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_0%_100%,rgba(0,0,0,0.18),transparent_48%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_115%,rgba(0,0,0,0.28),transparent_58%)]"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-black/30 via-black/10 to-transparent"
      />
      <div
        aria-hidden
        className="caretip-interactive-credit-card__grain absolute inset-0 opacity-[0.06] mix-blend-overlay"
      />
    </div>
  );

  const renderCaretipFront = () => (
    <>
      {caretipCardBackdrop}

      <div className="relative flex h-full flex-col justify-between p-5 text-white sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <EmvChip />
            <ContactlessMark />
          </div>
          <div
            className="flex items-center gap-1 rounded-full border border-white/25 bg-white/15 px-2 py-1"
            aria-hidden
          >
            <Lock className="size-3 text-white" strokeWidth={2} />
            <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/90 sm:text-[10px]">
              Secure
            </span>
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/75 sm:text-[11px]">
            {frontEyebrow}
          </p>
          <p className="font-sans text-[1.65rem] font-semibold tracking-[-0.03em] text-white sm:text-[1.85rem]">
            {frontTitle}
            <span className="text-white/90">.</span>
          </p>
          <p className="max-w-[16rem] text-xs leading-relaxed text-white/80 sm:text-[0.8125rem]">
            {frontCaption}
          </p>
        </div>

        <div className="flex items-end justify-between gap-3 border-t border-white/20 pt-4">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-1 w-1 rounded-full bg-white/90" aria-hidden />
            <span className="text-[10px] font-medium tracking-wide text-white/75">
              {footerNote}
            </span>
          </div>
          <ShieldCheck className="size-4 text-white/75 sm:size-[1.125rem]" strokeWidth={1.5} aria-hidden />
        </div>
      </div>
    </>
  );

  const renderCaretipBack = () => (
    <>
      {caretipCardBackdrop}

      <div className="relative flex h-full flex-col justify-between p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15 sm:size-11">
            <ShieldCheck className="size-5 text-white" strokeWidth={1.75} aria-hidden />
          </div>
          <div className="min-w-0 pt-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80 sm:text-[11px]">
              {backTitle}
            </p>
            <p className="mt-1 text-sm font-medium leading-snug text-white sm:text-[0.9375rem]">
              {backLine1}
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-white/20 bg-black/15 px-4 py-3.5 backdrop-blur-[1px] sm:px-5 sm:py-4">
          <p className="text-xs leading-relaxed text-white/85 sm:text-[0.8125rem]">{backLine2}</p>
          <ul className="space-y-2 text-[11px] text-white/80 sm:text-xs" aria-hidden>
            <li className="flex items-center gap-2">
              <span className="size-1 shrink-0 rounded-full bg-[#635bff]/70" />
              {backBullet1}
            </li>
            <li className="flex items-center gap-2">
              <span className="size-1 shrink-0 rounded-full bg-white/90" />
              {backBullet2}
            </li>
          </ul>
        </div>

        <p className="text-center text-[10px] font-medium tracking-wide text-white/70">
          {backDisclaimer}
        </p>
      </div>
    </>
  );

  return (
    <div
      className={cn("caretip-interactive-credit-card relative w-full", className)}
      {...props}
    >
      <motion.div
        className="caretip-interactive-credit-card__stage relative mx-auto aspect-[1.586/1] w-full max-w-[20rem] sm:max-w-[23rem] lg:max-w-[26rem]"
        style={{ perspective: PERSPECTIVE }}
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96 }}
        whileInView={prefersReducedMotion ? undefined : { opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: "-8%" }}
        transition={{ duration: CARD_ANIMATION_DURATION, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className="relative h-full w-full cursor-pointer"
          style={{
            transformStyle: "preserve-3d",
            rotateX: disableTilt || prefersReducedMotion ? 0 : rotateX,
            rotateY: isFlipped ? 180 : disableTilt || prefersReducedMotion ? 0 : rotateYMotion,
          }}
          animate={{ scale: isClicked ? 0.985 : 1 }}
          transition={{ duration: 0.35, type: "spring", stiffness: 140, damping: 20 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={flipCard}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              flipCard();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Secure payment visualization, tap to view processor details"
        >
          <motion.div
            className={cn(
              "absolute inset-0 overflow-hidden rounded-2xl",
              variantStyles[variant],
              variant === "caretip" ? "text-white" : undefined,
            )}
            style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
          >
            {variant === "caretip" ? (
              renderCaretipFront()
            ) : (
              <LegacyCardFace
                variant={variant}
                cardNumber={cardNumber}
                cardHolder={cardHolder}
                expiryDate={expiryDate}
                prefersReducedMotion={prefersReducedMotion}
              />
            )}
          </motion.div>

          <motion.div
            className={cn(
              "absolute inset-0 overflow-hidden rounded-2xl",
              variantStyles[variant],
              variant === "caretip" ? "text-white" : undefined,
            )}
            style={{
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
            }}
          >
            {variant === "caretip" ? (
              renderCaretipBack()
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/80">
                {backLine1}
              </div>
            )}
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}

/** Minimal legacy faces for non-caretip demo variants. */
function LegacyCardFace({
  variant,
  cardNumber,
  cardHolder,
  expiryDate,
  prefersReducedMotion,
}: {
  variant: "gradient" | "dark" | "glass";
  cardNumber: string;
  cardHolder: string;
  expiryDate: string;
  prefersReducedMotion: boolean;
}) {
  return (
    <div className="relative flex h-full flex-col justify-between p-5 text-white sm:p-6">
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, x: -12 }}
        animate={prefersReducedMotion ? undefined : { opacity: 1, x: 0 }}
        transition={{ delay: INITIAL_DELAY }}
        className="flex items-center gap-3"
      >
        <EmvChip />
        <ContactlessMark />
      </motion.div>
      <div className="font-mono text-lg tracking-wider sm:text-xl">{cardNumber}</div>
      <div className="flex items-end justify-between gap-3 text-xs sm:text-sm">
        <span>{cardHolder}</span>
        <span>{expiryDate}</span>
      </div>
    </div>
  );
}
