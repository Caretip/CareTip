/** Shared motion timings for Reanimated micro-interactions. */
export const motion = {
  duration: {
    instant: 120,
    fast: 180,
    normal: 260,
    slow: 400,
  },
  spring: {
    snappy: { damping: 20, stiffness: 380 },
    soft: { damping: 18, stiffness: 220 },
    press: { damping: 18, stiffness: 320 },
  },
  entrance: {
    fade: 280,
    translateY: 10,
  },
} as const;
