import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  BedDouble,
  BriefcaseMedical,
  HeartHandshake,
  Ticket,
  Truck,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import {
  ALL_INDUSTRY_PAGE_IDS,
  industryPath,
  type IndustryPageId,
} from "@/app/data/industryPages";
import { warmIndustryHero } from "@/lib/industryHeroAssets";
import { cn } from "@/lib/utils";
import { IndustryBackground } from "./IndustryBackground";
import { IndustryGlassCard } from "./IndustryGlassCard";
import { IndustryNavigation } from "./IndustryNavigation";
import { IndustryProgress } from "./IndustryProgress";

const INDUSTRY_ICONS: Record<IndustryPageId, LucideIcon> = {
  gastronomy: UtensilsCrossed,
  hotels: BedDouble,
  logistics: Truck,
  midwives: HeartHandshake,
  fairs: Ticket,
  "field-service": BriefcaseMedical,
};

const TRANSITION = { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const };
const WHEEL_THRESHOLD = 40;
/** Ignore further wheel ticks after a successful industry snap. */
const WHEEL_COOLDOWN_MS = 520;
const DRAG_THRESHOLD = 56;
const ANIMATION_MS = 580;

type IndustryShowcaseProps = {
  className?: string;
};

/**
 * Immersive one-at-a-time industry showcase — drawer vertical snap + BG cross-fade.
 * Intercepts wheel/touch only while another industry is available; releases at ends.
 */
export function IndustryShowcase({ className }: IndustryShowcaseProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const ids = ALL_INDUSTRY_PAGE_IDS;
  const total = ids.length;

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  const indexRef = useRef(0);
  const isAnimatingRef = useRef(false);
  const wheelAccRef = useRef(0);
  const wheelCooldownUntilRef = useRef(0);
  const dragStartY = useRef<number | null>(null);
  const dragActiveRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);

  indexRef.current = index;

  const activeId = ids[index]!;
  const prefix = "landing.industriesTeaser";

  const labels = useMemo(
    () => ids.map((id) => t(`${prefix}.cards.${id}.title`)),
    [ids, t],
  );

  const animMs = reduceMotion ? 80 : ANIMATION_MS;

  /** Sequential navigation — no wrap. Returns whether a transition started. */
  const goTo = useCallback(
    (nextRaw: number, dir?: number): boolean => {
      if (isAnimatingRef.current) return false;
      if (nextRaw < 0 || nextRaw >= total) return false;
      if (nextRaw === indexRef.current) return false;

      isAnimatingRef.current = true;
      wheelAccRef.current = 0;
      wheelCooldownUntilRef.current = Date.now() + WHEEL_COOLDOWN_MS;

      const from = indexRef.current;
      setDirection(dir ?? (nextRaw > from ? 1 : -1));
      setIndex(nextRaw);

      window.setTimeout(() => {
        isAnimatingRef.current = false;
      }, animMs);

      return true;
    },
    [total, animMs],
  );

  const goNext = useCallback(() => goTo(indexRef.current + 1, 1), [goTo]);
  const goPrev = useCallback(() => goTo(indexRef.current - 1, -1), [goTo]);

  // Prefetch active + adjacent heroes (clamp at ends — no wrap)
  useEffect(() => {
    void warmIndustryHero(activeId, { priority: "high" });
    if (index > 0) void warmIndustryHero(ids[index - 1]!, { priority: "low" });
    if (index < total - 1) void warmIndustryHero(ids[index + 1]!, { priority: "low" });
  }, [activeId, index, ids, total]);

  // Wheel / trackpad — intercept only when another industry exists in that direction.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;

      const i = indexRef.current;
      const atFirst = i <= 0;
      const atLast = i >= total - 1;
      const scrollingDown = e.deltaY > 0;
      const scrollingUp = e.deltaY < 0;

      // Boundary escape: do not preventDefault — page scroll continues.
      if ((scrollingDown && atLast) || (scrollingUp && atFirst)) {
        wheelAccRef.current = 0;
        return;
      }

      // Mid-carousel: own the gesture for industry snap.
      e.preventDefault();

      if (isAnimatingRef.current) return;
      if (Date.now() < wheelCooldownUntilRef.current) return;

      wheelAccRef.current += e.deltaY;
      if (Math.abs(wheelAccRef.current) < WHEEL_THRESHOLD) return;

      const dir = wheelAccRef.current > 0 ? 1 : -1;
      wheelAccRef.current = 0;

      if (dir > 0) goNext();
      else goPrev();
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [goNext, goPrev, total]);

  // Touch / pointer drag — same boundary release rules.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("a, button")) return;
      if (e.button !== 0 && e.pointerType === "mouse") return;
      dragStartY.current = e.clientY;
      dragActiveRef.current = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (dragStartY.current == null) return;

      const delta = e.clientY - dragStartY.current;
      const i = indexRef.current;
      const atFirst = i <= 0;
      const atLast = i >= total - 1;
      // Swipe up → next; swipe down → previous
      const towardNext = delta < 0;
      const towardPrev = delta > 0;

      if ((towardNext && atLast) || (towardPrev && atFirst)) {
        // Release — allow native page scroll past the section.
        dragStartY.current = null;
        dragActiveRef.current = false;
        return;
      }

      if (Math.abs(delta) < 12) return;

      // Claiming the gesture for industry navigation.
      if (!dragActiveRef.current) {
        dragActiveRef.current = true;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      e.preventDefault();
    };

    const finishDrag = (e: PointerEvent) => {
      if (dragStartY.current == null) return;
      const delta = e.clientY - dragStartY.current;
      const wasActive = dragActiveRef.current;
      dragStartY.current = null;
      dragActiveRef.current = false;

      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      if (!wasActive || isAnimatingRef.current) return;
      if (Math.abs(delta) < DRAG_THRESHOLD) return;

      if (delta < 0) goNext();
      else goPrev();
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove, { passive: false });
    el.addEventListener("pointerup", finishDrag);
    el.addEventListener("pointercancel", finishDrag);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", finishDrag);
      el.removeEventListener("pointercancel", finishDrag);
    };
  }, [goNext, goPrev, total]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as Node | null;
      if (!target || !el.contains(target)) return;

      if (e.key === "ArrowDown" || e.key === "PageDown") {
        if (indexRef.current >= total - 1) return;
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        if (indexRef.current <= 0) return;
        e.preventDefault();
        goPrev();
      } else if (e.key === "Home") {
        e.preventDefault();
        goTo(0, -1);
      } else if (e.key === "End") {
        e.preventDefault();
        goTo(total - 1, 1);
      }
    };

    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, goTo, total]);

  const cardVariants = reduceMotion
    ? {
        enter: { opacity: 0 },
        center: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        enter: (d: number) => ({ y: d > 0 ? 56 : -56, opacity: 0 }),
        center: { y: 0, opacity: 1 },
        exit: (d: number) => ({ y: d > 0 ? -56 : 56, opacity: 0 }),
      };

  const Icon = INDUSTRY_ICONS[activeId];
  const atFirst = index <= 0;
  const atLast = index >= total - 1;

  return (
    <div
      ref={stageRef}
      className={cn(
        "caretip-industry-showcase w-full max-w-full rounded-3xl",
        className,
      )}
      tabIndex={0}
      role="region"
      aria-roledescription="carousel"
      aria-label={t(`${prefix}.teasersAria`)}
    >
      <IndustryBackground activeId={activeId} />

      <div className="caretip-industry-showcase__stage">
        <IndustryProgress
          index={index}
          total={total}
          labels={labels}
          onSelect={(i) => goTo(i, i > index ? 1 : -1)}
        />

        <div className="caretip-industry-showcase__card-slot" aria-live="polite">
          <AnimatePresence initial={false} custom={direction} mode="wait">
            <motion.div
              key={activeId}
              custom={direction}
              variants={cardVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={reduceMotion ? { duration: 0.2 } : TRANSITION}
              className="caretip-industry-showcase__card-motion"
            >
              <IndustryGlassCard
                title={t(`${prefix}.cards.${activeId}.title`)}
                teaser={t(`${prefix}.cards.${activeId}.teaser`)}
                ctaLabel={t(`${prefix}.learnMore`)}
                href={industryPath(activeId)}
                Icon={Icon}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        <IndustryNavigation
          onPrev={goPrev}
          onNext={goNext}
          prevLabel={t(`${prefix}.navPrev`)}
          nextLabel={t(`${prefix}.navNext`)}
          prevDisabled={atFirst}
          nextDisabled={atLast}
        />
      </div>

      <p className="caretip-industry-showcase__hint" aria-hidden>
        {t(`${prefix}.navHint`)}
      </p>
    </div>
  );
}
