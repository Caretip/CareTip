let loading: Promise<void> | null = null;
let loaded = false;

export function landingStylesLoaded(): boolean {
  return loaded;
}

/**
 * Landing styles are over a third of the app's CSS. Kept out of the main stylesheet, so dashboards
 * and the guest tip flow do not download and parse them before first paint.
 */
export function loadLandingStyles(): Promise<void> {
  loading ??= import("@/styles/bundles/landing.css").then(
    () => {
      loaded = true;
    },
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}
