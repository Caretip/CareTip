"use client";

import { useState } from "react";
import { motion } from "motion/react";
import clsx from "clsx";

interface BackgroundCirclesProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  variant?: keyof typeof COLOR_VARIANTS;
  /** URL for the pulsing center image (QR code or phone with QR). Replaces the pulsing circles. */
  centerImageUrl?: string;
  centerImageAlt?: string;
  /** Optional slot for custom hero content (e.g. CTA buttons, features) */
  children?: React.ReactNode;
}

const COLOR_VARIANTS = {
  primary: {
    border: [
      "border-gray-200/60 dark:border-neutral-800/60",
      "border-gray-200/40 dark:border-neutral-800/40",
      "border-gray-200/25 dark:border-neutral-800/25",
    ],
    gradient: "from-primary/20",
    glow: "bg-[radial-gradient(ellipse_at_center,rgba(235,153,44,0.25),transparent_70%)]",
  },
  secondary: {
    border: [
      "border-gray-200/60 dark:border-neutral-800/60",
      "border-gray-200/40 dark:border-neutral-800/40",
      "border-gray-200/25 dark:border-neutral-800/25",
    ],
    gradient: "from-primary/20",
    glow: "bg-[radial-gradient(ellipse_at_center,rgba(235,153,44,0.25),transparent_70%)]",
  },
  tertiary: {
    border: [
      "border-gray-200/60 dark:border-neutral-800/60",
      "border-gray-200/40 dark:border-neutral-800/40",
      "border-gray-200/25 dark:border-neutral-800/25",
    ],
    gradient: "from-primary/20",
    glow: "bg-[radial-gradient(ellipse_at_center,rgba(235,153,44,0.25),transparent_70%)]",
  },
  quaternary: {
    border: [
      "border-gray-200/60 dark:border-neutral-800/60",
      "border-gray-200/40 dark:border-neutral-800/40",
      "border-gray-200/25 dark:border-neutral-800/25",
    ],
    gradient: "from-primary/20",
    glow: "bg-[radial-gradient(ellipse_at_center,rgba(235,153,44,0.25),transparent_70%)]",
  },
  quinary: {
    border: [
      "border-gray-200/60 dark:border-neutral-800/60",
      "border-gray-200/40 dark:border-neutral-800/40",
      "border-gray-200/25 dark:border-neutral-800/25",
    ],
    gradient: "from-primary/20",
    glow: "bg-[radial-gradient(ellipse_at_center,rgba(235,153,44,0.25),transparent_70%)]",
  },
  senary: {
    border: [
      "border-gray-200/60 dark:border-neutral-800/60",
      "border-gray-200/40 dark:border-neutral-800/40",
      "border-gray-200/25 dark:border-neutral-800/25",
    ],
    gradient: "from-primary/20",
    glow: "bg-[radial-gradient(ellipse_at_center,rgba(235,153,44,0.25),transparent_70%)]",
  },
  septenary: {
    border: [
      "border-gray-200/60 dark:border-neutral-800/60",
      "border-gray-200/40 dark:border-neutral-800/40",
      "border-gray-200/25 dark:border-neutral-800/25",
    ],
    gradient: "from-primary/20",
    glow: "bg-[radial-gradient(ellipse_at_center,rgba(235,153,44,0.25),transparent_70%)]",
  },
  octonary: {
    border: [
      "border-gray-200/60 dark:border-neutral-800/60",
      "border-gray-200/40 dark:border-neutral-800/40",
      "border-gray-200/25 dark:border-neutral-800/25",
    ],
    gradient: "from-primary/20",
    glow: "bg-[radial-gradient(ellipse_at_center,rgba(235,153,44,0.25),transparent_70%)]",
  },
  caretip: {
    border: [
      "border-gray-200/60 dark:border-neutral-800/60",
      "border-gray-200/40 dark:border-neutral-800/40",
      "border-gray-200/25 dark:border-neutral-800/25",
    ],
    gradient: "from-primary/20",
    glow: "bg-[radial-gradient(ellipse_at_center,rgba(235,153,44,0.25),transparent_70%)]",
  },
} as const;

export type BackgroundCirclesVariant = keyof typeof COLOR_VARIANTS;

/** Demo with variant switcher - for testing different color themes */
export function DemoCircles() {
  const [currentVariant, setCurrentVariant] =
    useState<BackgroundCirclesVariant>("caretip");

  const variants = Object.keys(COLOR_VARIANTS) as BackgroundCirclesVariant[];

  const getNextVariant = () => {
    const i = variants.indexOf(currentVariant);
    return variants[(i + 1) % variants.length];
  };

  return (
    <>
      <BackgroundCircles
        title="Demo Circles"
        description="Click the button to cycle color variants"
        variant={currentVariant}
      />
      <div className="absolute right-4 top-4 z-20">
        <button
          type="button"
          className="rounded-md bg-foreground px-4 py-1 text-sm font-medium text-background"
          onClick={() => setCurrentVariant(getNextVariant())}
        >
          Change Variant
        </button>
      </div>
    </>
  );
}

const AnimatedGrid = () => (
  <motion.div
    className="absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,transparent_30%,black)]"
    animate={{
      backgroundPosition: ["0% 0%", "100% 100%"],
    }}
    transition={{
      duration: 40,
      repeat: Number.POSITIVE_INFINITY,
      ease: "linear",
    }}
  >
    <div className="h-full w-full [background-image:repeating-linear-gradient(100deg,#64748B_0%,#64748B_1px,transparent_1px,transparent_4%)] opacity-20" />
  </motion.div>
);

// Phone scanning QR code - Stockcake-style digital/mobile imagery
const DEFAULT_PHONE_QR_IMAGE =
  "https://images.unsplash.com/photo-1556656793-08538906a9f8?q=80&w=800&auto=format&fit=crop";

export function BackgroundCircles({
  title = "Background Circles",
  description = "Optional Description",
  className,
  variant = "caretip",
  centerImageUrl = DEFAULT_PHONE_QR_IMAGE,
  centerImageAlt = "Phone with QR code for digital tips",
  children,
}: BackgroundCirclesProps) {
  const variantStyles = COLOR_VARIANTS[variant];

  return (
    <div
      className={clsx(
        "relative flex min-h-[90vh] w-full items-center justify-center overflow-hidden",
        variant === "caretip" ? "bg-neutral-950" : "bg-background",
        className
      )}
    >
      <AnimatedGrid />

      {/* Pulsing center/right: image (QR / phone) instead of circles */}
      <motion.div className="absolute right-0 top-1/2 flex h-[400px] w-[400px] -translate-y-1/2 items-center justify-center lg:right-16 lg:h-[480px] lg:w-[480px]">
        <motion.div
          className="relative h-[260px] w-[260px] overflow-hidden rounded-2xl shadow-2xl ring-2 ring-white/20 lg:h-[320px] lg:w-[320px]"
          animate={{
            scale: [1, 1.05, 1],
            opacity: [0.9, 1, 0.9],
          }}
          transition={{
            duration: 3,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        >
          <img
            src={centerImageUrl}
            alt={centerImageAlt}
            className="h-full w-full object-cover"
          />
          <div
            className={clsx(
              "absolute inset-0 rounded-2xl mix-blend-overlay opacity-30",
              variantStyles.glow
            )}
          />
        </motion.div>
      </motion.div>

      {/* Hero content overlay - left side */}
      <motion.div
        className="relative z-10 flex w-full max-w-7xl flex-col items-start px-6 py-20 text-left"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        <div className="flex-1 max-w-2xl">
          <h1
            className={clsx(
              "text-4xl font-bold tracking-tight md:text-6xl",
              variant === "caretip" ? "text-white" : "text-foreground"
            )}
          >
            {title}
          </h1>
          <div
            className={clsx(
              "mt-6 text-lg md:text-xl",
              variant === "caretip" ? "text-white/80" : "text-muted-foreground"
            )}
          >
            {description}
          </div>
          {children}
        </div>
      </motion.div>

      {/* Ambient glow */}
      <div className="absolute inset-0 [mask-image:radial-gradient(90%_60%_at_50%_50%,#000_40%,transparent)]">
        <div
          className={clsx(
            "absolute inset-0 blur-[120px]",
            COLOR_VARIANTS.caretip.glow
          )}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(235,153,44,0.18),transparent)] blur-[80px]" />
      </div>
    </div>
  );
}
