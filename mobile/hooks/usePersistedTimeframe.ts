import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Persists dashboard / QR period toggles across restarts (preference polish).
 * `ready` is false until AsyncStorage has been read once so callers can avoid
 * firing a default-key query that immediately remounts when the stored period loads.
 */
export function usePersistedTimeframe<T extends string>(
  storageKey: string,
  defaultValue: T,
): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(defaultValue);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (!cancelled && raw && raw.length > 0) {
          setValue(raw as T);
        }
      } catch {
        /* ignore — use default */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const setPersisted = (next: T) => {
    setValue(next);
    void AsyncStorage.setItem(storageKey, next).catch(() => {
      /* non-fatal */
    });
  };

  return [value, setPersisted, ready];
}
