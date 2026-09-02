import { fetchLocations, fetchTables, type LocationDTO, type TableDTO } from "./api";
import { isApiSubscriptionRequiredError } from "./apiError";
import { createDashboardSwrStore } from "./dashboardSwrCache";
import { trackVenueCatalogCacheHit, trackVenueCatalogCacheMiss, trackVenueCatalogFetch } from "./realtime/realtimeMetrics";

const VENUE_CATALOG_TTL_MS = 60_000;

type VenueCatalogEntry = {
  locations: LocationDTO[];
  tables: TableDTO[];
};

const venueStore = createDashboardSwrStore<VenueCatalogEntry>();

function readCached(): VenueCatalogEntry | null {
  return venueStore.get("venue-catalog", VENUE_CATALOG_TTL_MS);
}

/** Shared session cache for locations + tables (QR Studio, Staff, Tables pages). */
export async function fetchVenueCatalog(opts?: {
  signal?: AbortSignal;
  revalidate?: boolean;
}): Promise<VenueCatalogEntry> {
  if (!opts?.revalidate) {
    const hit = readCached();
    if (hit) {
      trackVenueCatalogCacheHit();
      return hit;
    }
  }

  trackVenueCatalogCacheMiss();
  trackVenueCatalogFetch();

  const [locations, tablesResult] = await Promise.all([
    fetchLocations(),
    fetchTables({ silent: true }).catch((err) => {
      if (!isApiSubscriptionRequiredError(err)) throw err;
      return [] as TableDTO[];
    }),
  ]);

  const entry: VenueCatalogEntry = {
    locations: Array.isArray(locations) ? locations : [],
    tables: Array.isArray(tablesResult) ? tablesResult : [],
  };
  venueStore.set("venue-catalog", entry);
  return entry;
}

export async function fetchLocationsCached(opts?: {
  signal?: AbortSignal;
  revalidate?: boolean;
}): Promise<LocationDTO[]> {
  const catalog = await fetchVenueCatalog(opts);
  return catalog.locations;
}

export async function fetchTablesCached(opts?: {
  signal?: AbortSignal;
  revalidate?: boolean;
}): Promise<TableDTO[]> {
  const catalog = await fetchVenueCatalog(opts);
  return catalog.tables;
}

export function invalidateVenueCatalog(): void {
  venueStore.delete("venue-catalog");
}

/** Write-through after a successful location/table mutation so other pages see it immediately. */
export function writeVenueCatalog(entry: VenueCatalogEntry): void {
  venueStore.set("venue-catalog", {
    locations: entry.locations,
    tables: entry.tables,
  });
}

export function writeVenueCatalogLocations(locations: LocationDTO[]): void {
  const prev = venueStore.peek("venue-catalog");
  writeVenueCatalog({
    locations,
    tables: prev?.tables ?? [],
  });
}

export function writeVenueCatalogTables(tables: TableDTO[], locations?: LocationDTO[]): void {
  const prev = venueStore.peek("venue-catalog");
  writeVenueCatalog({
    locations: locations ?? prev?.locations ?? [],
    tables,
  });
}

export function clearVenueCatalogStore(): void {
  venueStore.clear();
}
