type CacheEntry = {
  buffer: Buffer;
  etag: string;
  fingerprint: string;
  at: number;
};

const MAX_ENTRIES = 256;
const store = new Map<string, CacheEntry>();

export const brandedQrCache = {
  get(key: string): CacheEntry | null {
    return store.get(key) ?? null;
  },
  set(key: string, entry: CacheEntry): void {
    if (store.size >= MAX_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest) store.delete(oldest);
    }
    store.set(key, entry);
  },
  invalidateBusiness(businessId: string): void {
    const prefix = `${businessId}:`;
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
  },
};
