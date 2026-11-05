export type DeployBuildInfo = { version: string; buildTime: string };

/** Same alphabet `scripts/deploy-build-version.mjs` produces; anything else is treated as invalid. */
const DEPLOY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

export const UNVERSIONED_BUILD = "dev";

export function isValidDeployVersion(value: unknown): value is string {
  return typeof value === "string" && DEPLOY_VERSION_PATTERN.test(value);
}

/** Version baked into this bundle at build time; `"dev"` under the Vite dev server or test loaders. */
export function runningDeployBuild(): DeployBuildInfo {
  const version =
    typeof __CARETIP_BUILD_VERSION__ === "string" && isValidDeployVersion(__CARETIP_BUILD_VERSION__)
      ? __CARETIP_BUILD_VERSION__
      : UNVERSIONED_BUILD;
  const buildTime = typeof __CARETIP_BUILD_TIME__ === "string" ? __CARETIP_BUILD_TIME__ : "";
  return { version, buildTime };
}

export function isVersionedBuild(version: string): boolean {
  return version !== UNVERSIONED_BUILD && isValidDeployVersion(version);
}
