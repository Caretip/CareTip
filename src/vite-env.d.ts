/**
 * Vite + PWA client shims.
 * Kept self-contained so the IDE typechecks when `node_modules/vite` is not installed
 * (e.g. disk-full installs). Compatible with `vite/client` via declaration merging.
 */

interface ImportMetaEnv {
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly SSR: boolean;
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
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly hot?: {
    readonly data: unknown;
    accept: {
      (): void;
      (cb: (mod: unknown) => void): void;
      (dep: string, cb: (mod: unknown) => void): void;
      (deps: readonly string[], cb: (mods: unknown[]) => void): void;
    };
    dispose: (cb: (data: unknown) => void) => void;
    invalidate: (message?: string) => void;
  };
  glob: {
    <T = unknown>(
      pattern: string,
      options?: { eager?: boolean; import?: string; query?: string | Record<string, string> },
    ): Record<string, T | (() => Promise<T>)>;
  };
}

declare module "*.svg?raw" {
  const src: string;
  export default src;
}
declare module "*.png?inline" {
  const src: string;
  export default src;
}
declare module "*.svg" {
  const src: string;
  export default src;
}
declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.jpg" {
  const src: string;
  export default src;
}
declare module "*.jpeg" {
  const src: string;
  export default src;
}
declare module "*.webp" {
  const src: string;
  export default src;
}
declare module "*.gif" {
  const src: string;
  export default src;
}
declare module "*.woff" {
  const src: string;
  export default src;
}
declare module "*.woff2" {
  const src: string;
  export default src;
}

declare module "virtual:pwa-register" {
  export type RegisterSWOptions = {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  };
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
