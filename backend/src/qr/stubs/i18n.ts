/**
 * Node QR render stub — the canvas bundle does not load full i18next.
 * Call sites must pass `defaultValue` for any user-facing copy.
 * Never return raw translation keys to the QR card.
 */
const i18n = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const defaultValue = opts?.defaultValue;
    if (typeof defaultValue === "string" && defaultValue.trim()) {
      return defaultValue;
    }
    return key;
  },
};

export default i18n;
