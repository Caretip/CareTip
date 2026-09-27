import i18next, { type TFunction } from "i18next";
import de from "../../src/i18n/locales/de.json";

let initialized = false;

/** German bundle for build-time public HTML (matches index.html default lang="de"). */
export function getBuildTimeSeoT(): TFunction {
  if (!initialized) {
    i18next.init({
      lng: "de",
      fallbackLng: "de",
      resources: { de: { translation: de } },
      initAsync: false,
    });
    initialized = true;
  }
  return i18next.t.bind(i18next);
}
