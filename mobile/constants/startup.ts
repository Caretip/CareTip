/** Maximum time to block on any single startup I/O or network call. */
export const STARTUP_TASK_TIMEOUT_MS = 5_000;

/** Hard ceiling — native splash always hides by this deadline. */
export const STARTUP_SPLASH_MAX_MS = 5_000;

/** Fallback if InteractionManager never settles after hide is requested. */
export const SPLASH_HIDE_FALLBACK_MS = 400;
