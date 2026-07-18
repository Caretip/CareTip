import { motion } from "motion/react";
import { Award, Star, Target, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarketingPicture } from "@/lib/marketingPicture";
import trophyWebp from "../../../../images/trophy.webp";
import trophyAvif from "../../../../images/trophy.avif";

function Medal3D() {
  return (
    <div className="relative h-12 w-12 overflow-hidden rounded-2xl ring-1 ring-black/[0.08]">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.85), rgba(255,255,255,0.14))",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.85), transparent 55%), radial-gradient(circle at 70% 80%, rgba(233,120,28,0.25), transparent 60%)",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="h-8 w-8 rounded-full ring-1 ring-primary/15 shadow-[0_18px_44px_rgba(233,120,28,0.18)]"
          style={{
            background: "linear-gradient(180deg, #FFF4D6, #F2C76E 40%, #B77B1B)",
          }}
        />
      </div>
    </div>
  );
}

function Orb3D() {
  return (
    <div className="relative h-12 w-12 overflow-hidden rounded-2xl ring-1 ring-black/[0.08]">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.85), rgba(255,255,255,0.14))",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="h-8 w-8 rounded-full ring-1 ring-primary/15 shadow-[0_14px_36px_rgba(233,120,28,0.18)]"
          style={{
            background:
              "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.95), rgba(255,255,255,0.15) 40%, rgba(233,120,28,0.08) 75%)",
          }}
        />
      </div>
      <div
        aria-hidden
        className="absolute -bottom-4 left-1/2 h-10 w-10 -translate-x-1/2 rounded-full blur-xl"
        style={{ background: "rgba(233,120,28,0.18)" }}
      />
    </div>
  );
}

function Ribbon3D() {
  return (
    <div className="relative h-12 w-12 overflow-hidden rounded-2xl ring-1 ring-black/[0.08]">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.75), rgba(255,255,255,0.10))",
        }}
      />
      <div
        aria-hidden
        className="absolute left-3 top-1.5 h-9 w-6 rounded-xl"
        style={{
          background: "linear-gradient(180deg, rgba(233,120,28,0.65), rgba(233,120,28,0.18))",
          boxShadow: "0 18px 40px rgba(233,120,28,0.18)",
        }}
      />
      <div
        aria-hidden
        className="absolute right-3 top-1.5 h-9 w-6 rounded-xl bg-black/10"
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-3 w-3 rounded-full bg-primary shadow-[0_16px_40px_rgba(233,120,28,0.22)]" />
      </div>
    </div>
  );
}

type Leader = {
  id: string;
  name: string;
  goalLabel: string;
  progress: number; // 0..100
  tone: "gold" | "silver" | "bronze";
};

function LeaderCard({ leader, isTop }: { leader: Leader; isTop: boolean }) {
  const tone =
    leader.tone === "gold"
      ? {
          chip: "bg-[#FFF3D8] text-[#7B4F0A] ring-[#F2C76E]/60",
          edge: "border-[#F2C76E]/55",
          sheen:
            "linear-gradient(135deg, rgba(255,255,255,0.70), rgba(255,255,255,0.14) 45%, rgba(233,120,28,0.12))",
        }
      : leader.tone === "silver"
        ? {
            chip: "bg-[#F4F6F8] text-[#2F3A44] ring-black/[0.08]",
            edge: "border-white/55",
            sheen:
              "linear-gradient(135deg, rgba(255,255,255,0.78), rgba(255,255,255,0.16) 45%, rgba(0,0,0,0.05))",
          }
        : {
            chip: "bg-[#FFF1E7] text-[#5B3A06] ring-black/[0.08]",
            edge: "border-white/45",
            sheen:
              "linear-gradient(135deg, rgba(255,255,255,0.68), rgba(255,255,255,0.12) 45%, rgba(123,79,10,0.10))",
          };

  return (
    <div
      className={[
        "relative overflow-hidden rounded-[26px] border bg-white/22 backdrop-blur-xl ring-1 ring-black/[0.10]",
        "shadow-[0_34px_110px_rgba(0,0,0,0.22)]",
        tone.edge,
      ].join(" ")}
      style={{ background: "rgba(255,255,255,0.18)" }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-95" style={{ background: tone.sheen }} />

      <div className="relative p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-gray-600">Top performers</p>
            <p className="mt-1 truncate text-base font-black text-gray-900">
              {leader.name} {isTop ? <span className="ml-1 align-middle">🔥</span> : null}
            </p>
          </div>
          <div className={["inline-flex items-center rounded-full px-3 py-1 text-xs font-black ring-1", tone.chip].join(" ")}>
            {leader.tone.toUpperCase()}
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-white/45 p-3 ring-1 ring-black/[0.06]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold text-gray-600">{leader.goalLabel}</p>
            <p className="text-[11px] font-black text-gray-900">{leader.progress}%</p>
          </div>
          <div className="mt-2 h-2.5 w-full rounded-full bg-black/10">
            <div
              className="h-2.5 rounded-full"
              style={{
                width: `${leader.progress}%`,
                background: "#e9781c",
                boxShadow: "0 18px 44px rgba(233,120,28,0.22)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function DynamicLeaderboard() {
  const leaders = useMemo<Leader[]>(
    () => [
      { id: "a", name: "Amina", goalLabel: "Tips goal", progress: 78, tone: "gold" },
      { id: "b", name: "Jordan", goalLabel: "Tips goal", progress: 64, tone: "silver" },
      { id: "c", name: "Luca", goalLabel: "Tips goal", progress: 52, tone: "bronze" },
    ],
    [],
  );

  // order represents which leader occupies [top, middle, bottom]
  const [order, setOrder] = useState<[number, number, number]>([0, 1, 2]);
  const [middleGlow, setMiddleGlow] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      // middle card "wins" -> swap into top position (rank-swap)
      setMiddleGlow(true);
      window.setTimeout(() => {
        setOrder(([top, mid, bot]) => [mid, top, bot]);
        setMiddleGlow(false);
      }, 450);
    }, 5200);
    return () => window.clearInterval(id);
  }, []);

  const slots = [
    { key: "top", y: 0, scale: 1.02 },
    { key: "mid", y: 72, scale: 0.96 },
    { key: "bot", y: 140, scale: 0.92 },
  ] as const;

  return (
    <div className="relative mx-auto w-full max-w-[560px] overflow-visible">
      {/* subtle stage light */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-10 -z-10 blur-3xl"
        style={{
          background: "radial-gradient(460px circle at 50% 58%, rgba(233,120,28,0.18), transparent 62%)",
        }}
      />

      <div className="relative mx-auto h-[380px] w-full">
        {/* podium base */}
        <div aria-hidden className="absolute left-1/2 top-[240px] h-40 w-[92%] -translate-x-1/2 rounded-[60px] bg-black/10 blur-2xl" />

        {slots.map((slot, slotIndex) => {
          const leader = leaders[order[slotIndex]]!;
          const isTop = slotIndex === 0;
          const isMiddle = slotIndex === 1;

          return (
            <motion.div
              key={slot.key}
              className="absolute left-1/2 w-[92%] -translate-x-1/2"
              initial={false}
              animate={{
                y: slot.y,
                scale: slot.scale,
              }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              style={{
                zIndex: 10 - slotIndex,
              }}
            >
              <motion.div
                animate={
                  isMiddle && middleGlow
                    ? {
                        boxShadow: [
                          "0 34px 110px rgba(0,0,0,0.22)",
                          "0 34px 130px rgba(233,120,28,0.18)",
                          "0 34px 110px rgba(0,0,0,0.22)",
                        ],
                      }
                    : {}
                }
                transition={{ duration: 0.55, ease: "easeInOut" }}
                className="rounded-[26px]"
              >
                <LeaderCard leader={leader} isTop={isTop} />
              </motion.div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function ExplodedViewStage({
  headlineHover,
  recognitionHover,
}: {
  headlineHover: boolean;
  recognitionHover: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="relative mx-auto w-full max-w-[560px]"
    >
      {/* subtle stage light */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 rounded-full bg-primary/10 blur-3xl" />

      <motion.div
        className="relative h-[420px] w-full"
      >
        {/* group bob (slow) */}
        <motion.div
          className="absolute inset-0"
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
        >

        {/* BACKGROUND LAYER: chart panel (solid white) */}
        <motion.div
          className="absolute left-1/2 top-10 w-[92%] -translate-x-1/2 overflow-hidden rounded-3xl border border-black/[0.06] bg-white"
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="relative p-0">
            {/* full-bleed chart surface */}
            <div className="absolute inset-0">
              <div className="absolute inset-0 opacity-80 blur-[1px]" style={{ filter: "blur(10px)" }}>
                <div className="absolute left-8 top-16 h-28 w-[78%] rounded-3xl bg-black/[0.04] ring-1 ring-black/[0.04]" />
                <div className="absolute left-10 top-[170px] h-14 w-[22%] rounded-3xl bg-black/[0.03] ring-1 ring-black/[0.04]" />
                <div className="absolute left-[38%] top-[170px] h-14 w-[22%] rounded-3xl bg-black/[0.03] ring-1 ring-black/[0.04]" />
                <div className="absolute left-[66%] top-[170px] h-14 w-[22%] rounded-3xl bg-black/[0.03] ring-1 ring-black/[0.04]" />
              </div>
            </div>

            {/* label strip */}
            <div className="relative flex items-center justify-between px-6 pt-6">
              <p className="text-xs font-black text-gray-900">Performance</p>
              <div className="h-2 w-20 rounded-full bg-black/10" />
            </div>

            <div className="relative h-[300px]" />
          </div>
        </motion.div>

        {/* FOREGROUND LAYER: top performer badge (sharp) */}
        <motion.div
          className="absolute left-10 top-[220px] w-[260px] rounded-3xl border border-black/[0.06] bg-white p-4"
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 7.5, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-600">Top performer</p>
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-black text-emerald-600 dark:text-emerald-400">
              {t("status.live")}
            </span>
          </div>
          <p className="mt-2 text-base font-black text-gray-900">
            Amina <span className="ml-1">🔥</span>
          </p>
          <div className="relative mt-3 h-2.5 w-full rounded-full bg-black/10">
            {/* energy pulse behind bar */}
            <motion.div
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-full blur-md"
              style={{ width: "72%", background: "rgba(233,120,28,0.40)" }}
              animate={{ opacity: [0.15, 0.32, 0.15] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="relative h-2.5 w-[72%] rounded-full bg-primary shadow-[0_18px_44px_rgba(233,120,28,0.20)]" />
          </div>
          <p className="mt-2 text-xs font-semibold text-gray-600">Tips goal</p>
        </motion.div>

        {/* HERO: trophy outside cards */}
        <motion.div
          className="absolute right-4 top-6"
          animate={{ y: [0, -15, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        >
          <motion.div className="relative">
            {/* trophy image */}
            <div className="relative h-[240px] w-[210px] overflow-hidden rounded-[44px] ring-1 ring-black/[0.14]">
              <MarketingPicture
                src={trophyWebp}
                webpSrc={trophyWebp}
                avifSrc={trophyAvif}
                alt="CareTip trophy"
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />

              {/* gleam sweep */}
              <motion.div
                aria-hidden
                initial={false}
                animate={recognitionHover ? { x: ["-120%", "140%"] } : { x: "-120%" }}
                transition={recognitionHover ? { duration: 0.95, ease: "easeInOut" } : { duration: 0 }}
                className="pointer-events-none absolute inset-y-0 left-0 w-[45%]"
                style={{
                  opacity: recognitionHover ? 0.85 : 0,
                  background:
                    "linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.65) 45%, transparent 90%)",
                  filter: "blur(0.5px)",
                  mixBlendMode: "screen",
                }}
              />
            </div>
          </motion.div>
        </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}

export function StaffMotivationSection() {
  const [headlineHover, setHeadlineHover] = useState(false);
  const [recognitionHover, setRecognitionHover] = useState(false);

  const motivationFeatures = [
    {
      icon: Target,
      title: "Personal goals",
      description: "Monthly targets with clear progress."
    },
    {
      icon: Trophy,
      title: "Recognition",
      description: "Highlight top earners and healthy competition."
    },
    {
      icon: Star,
      title: "Guest ratings",
      description: "Feedback right after the tip."
    },
    {
      icon: Award,
      title: "Performance insights",
      description: "See peaks, trends, and what drives tips."
    }
  ];

  return (
    <section
      id="staff-motivation"
      className="scroll-mt-[80px] bg-white px-6 py-24"
    >
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 xl:gap-16 items-center lg:items-center">
          {/* Left: Visual */}
          <motion.div
            initial={{ x: -30, opacity: 0 }}
            whileInView={{ x: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="relative order-2 lg:order-1"
            whileHover={{ y: -5 }}
          >
            <ExplodedViewStage headlineHover={headlineHover} recognitionHover={recognitionHover} />
          </motion.div>

          {/* Right: Content */}
          <motion.div
            initial={{ x: 30, opacity: 0 }}
            whileInView={{ x: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="space-y-8 order-1 lg:order-2 text-center md:text-left"
          >
            <div className="space-y-4">
              <span className="inline-block px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-semibold">
                Staff performance
              </span>
              <h2
                className="text-3xl md:text-5xl font-bold text-black"
                onMouseEnter={() => setHeadlineHover(true)}
                onMouseLeave={() => setHeadlineHover(false)}
              >
                Motivate your team
                <br />
                <span className="font-semibold text-primary">
                  to excel
                </span>
              </h2>
              <p className="text-base md:text-lg leading-relaxed text-gray-500 max-w-md mx-auto md:mx-0">
                Track staff performance in real time. Set goals and see who’s leading the shift.
              </p>
            </div>

            {/* Features Grid */}
            <div className="grid sm:grid-cols-2 gap-6">
              {motivationFeatures.map((feature, index) => {
                const isPremium = feature.title === "Personal goals" || feature.title === "Recognition";
                return (
                  <motion.div
                    key={feature.title}
                    initial={{ y: 20, opacity: 0 }}
                    whileInView={{ y: 0, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: index * 0.08 }}
                    whileHover={{ y: -5 }}
                    onHoverStart={() => {
                      if (feature.title === "Recognition") setRecognitionHover(true);
                    }}
                    onHoverEnd={() => {
                      if (feature.title === "Recognition") setRecognitionHover(false);
                    }}
                    className={[
                      "rounded-3xl border border-black/[0.06] bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.06)]",
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-4">
                      <div className="caretip-marketing-icon-chip relative flex h-12 w-12 items-center justify-center rounded-3xl">
                        {feature.title === "Personal goals" ? (
                          <Orb3D />
                        ) : feature.title === "Recognition" ? (
                          <Ribbon3D />
                        ) : feature.title === "Guest ratings" ? (
                          <Orb3D />
                        ) : (
                          <feature.icon className="h-6 w-6" />
                        )}
                      </div>

                      <div className="min-w-0 space-y-1">
                        <h3 className="text-base font-bold text-black">{feature.title}</h3>
                        <p className="text-sm leading-relaxed text-gray-500">{feature.description}</p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
