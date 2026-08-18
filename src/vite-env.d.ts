/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Google Sign-In Web client ID (inlined at build). Same value as backend `GOOGLE_CLIENT_ID`. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Same as `VITE_GOOGLE_CLIENT_ID`; supported for hosts that only define `NEXT_PUBLIC_*` (e.g. some Vercel setups). */
  readonly NEXT_PUBLIC_GOOGLE_CLIENT_ID?: string;
  /** Apple Sign In Services ID (inlined at build). Same value as backend `APPLE_CLIENT_ID`. */
  readonly VITE_APPLE_CLIENT_ID?: string;
  /** Facebook Login App ID (inlined at build). Same value as backend `FACEBOOK_APP_ID`. */
  readonly VITE_FACEBOOK_APP_ID?: string;
  /** Official CareTip Facebook page. Optional override of the built-in profile URL. */
  readonly VITE_SOCIAL_FACEBOOK_URL?: string;
  /** Official CareTip Instagram profile. Optional override of the built-in profile URL. */
  readonly VITE_SOCIAL_INSTAGRAM_URL?: string;
  readonly VITE_SOCIAL_TIKTOK_URL?: string;
  readonly VITE_SOCIAL_LINKEDIN_URL?: string;
  /** Optional URL (e.g. `/videos/how-it-works.webm`) for the Live in minutes laptop demo; when unset, an in-browser slideshow is used. */
  readonly VITE_LIVE_IN_MINUTES_DEMO_VIDEO?: string;
  readonly VITE_API_URL?: string;
  /**
   * Injected at build/dev from `BASE_URL` / `VITE_BASE_URL` / `NEXT_PUBLIC_APP_URL` / `VITE_APP_URL`
   * (see `vite.config.ts`). Prefer setting **`BASE_URL`** in CI/host env for production QR links.
   */
  readonly VITE_CARETIP_APP_ORIGIN?: string;
  /** Optional public SPA origin for QR and share links (same semantics as part of `BASE_URL` chain). */
  readonly VITE_BASE_URL?: string;
  readonly NEXT_PUBLIC_BASE_URL?: string;
  /** @deprecated Prefer `BASE_URL` at build or `NEXT_PUBLIC_BASE_URL`. Legacy SPA origin for QR when others unset. */
  readonly VITE_APP_URL?: string;
  readonly NEXT_PUBLIC_APP_URL?: string;
  /** Ask CareTip landing assistant. Default off when unset. Set to `true` to show launcher + chat. */
  readonly VITE_ENABLE_AI_ASSISTANT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
