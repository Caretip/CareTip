import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Persists dashboard / QR period toggles across restarts (preference polish).
 */
export function usePersistedTimeframe<T extends string>(
  storageKey: string,
  defaultValue: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(defaultValue);

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

  return [value, setPersisted];
}
