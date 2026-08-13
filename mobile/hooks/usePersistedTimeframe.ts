import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Session cache so Analytics / Performance / remounts skip a second AsyncStorage wait. */
const timeframeMemory = new Map<string, string>();

/**
 * Persists dashboard / QR period toggles across restarts (preference polish).
 * `ready` is false until AsyncStorage has been read once so callers can avoid
 * firing a default-key query that immediately remounts when the stored period loads.
 */
export function usePersistedTimeframe<T extends string>(
  storageKey: string,
  defaultValue: T,
): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(() => {
    const hit = timeframeMemory.get(storageKey);
    return (hit as T | undefined) ?? defaultValue;
  });
  const [ready, setReady] = useState(() => timeframeMemory.has(storageKey));

  useEffect(() => {
    let cancelled = false;
    const cached = timeframeMemory.get(storageKey);
    if (cached != null) {
      setValue(cached as T);
      setReady(true);
      return;
    }

    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (cancelled) return;
        const next = raw && raw.length > 0 ? (raw as T) : defaultValue;
        timeframeMemory.set(storageKey, next);
        setValue(next);
      } catch {
        if (!cancelled) {
          timeframeMemory.set(storageKey, defaultValue);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storageKey, defaultValue]);

  const setPersisted = (next: T) => {
    setValue(next);
    timeframeMemory.set(storageKey, next);
    void AsyncStorage.setItem(storageKey, next).catch(() => {
      /* non-fatal */
    });
  };

  return [value, setPersisted, ready];
}
