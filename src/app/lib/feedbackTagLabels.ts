/**
 * CareTip preset feedback tags are stored as English API strings (and some seed camelCase keys).
 * Display labels are localized; stored values stay stable for analytics/history.
 */

export const FEEDBACK_TAG_I18N_PREFIX = "tipFlow.rating.tags";

const API_VALUE_TO_KEY: Record<string, string> = {
  "Excellent service": "excellentService",
  "Very friendly": "veryFriendly",
  "Fast and professional": "fastProfessional",
  Attentive: "attentive",
  "Great vibe": "greatVibe",
  "Above and beyond": "aboveBeyond",
  excellentService: "excellentService",
  veryFriendly: "veryFriendly",
  fastProfessional: "fastProfessional",
  attentive: "attentive",
  greatVibe: "greatVibe",
  aboveBeyond: "aboveBeyond",
  friendlyStaff: "veryFriendly",
  fastService: "fastProfessional",
  greatAtmosphere: "greatVibe",
};

export function feedbackTagI18nKey(stored: string): string | null {
  const trimmed = stored.trim();
  if (!trimmed) return null;
  return API_VALUE_TO_KEY[trimmed] ?? null;
}

export function localizeFeedbackTag(
  stored: string,
  t: (key: string) => string,
): string {
  const key = feedbackTagI18nKey(stored);
  if (!key) return stored;
  const i18nKey = `${FEEDBACK_TAG_I18N_PREFIX}.${key}`;
  const label = t(i18nKey);
  return label === i18nKey ? stored : label;
}
