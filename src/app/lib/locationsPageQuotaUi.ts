/** Locations page: show multi-location upgrade only at the location quota, not for all Basic accounts. */

export function isAtLocationCap(input: {
  ready: boolean;
  maxLocations: number | null | undefined;
  locationCount: number;
}): boolean {
  return (
    input.ready &&
    input.maxLocations != null &&
    input.locationCount >= input.maxLocations
  );
}

export function shouldShowMultiLocationUpgradeCard(input: {
  ready: boolean;
  hasMultiLocation: boolean;
  atLocationCap: boolean;
}): boolean {
  return input.ready && input.atLocationCap && !input.hasMultiLocation;
}
