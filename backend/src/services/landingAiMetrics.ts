export type LandingAiFallbackReason =
  | "off_topic"
  | "no_api_key"
  | "openai_http_error"
  | "openai_empty"
  | "openai_timeout"
  | "openai_network"
  | "daily_budget"
  | null;

export type LandingAiOutcomeSource = "openai" | "knowledge";

export type LandingAiMetricsSnapshot = {
  totalChats: number;
  openAiSuccess: number;
  openAiFailures: number;
  fallbackCount: number;
  quotaFailures: number;
  timeoutFailures: number;
  networkFailures: number;
  offTopicCount: number;
  noApiKeyCount: number;
  openAiSuccessRate: number;
  fallbackRate: number;
  quotaFailureRate: number;
  lastOpenAiSuccessAt: string | null;
  lastFallbackAt: string | null;
  lastFallbackReason: LandingAiFallbackReason;
  lastOpenAiHttpStatus: number | null;
};

const state = {
  totalChats: 0,
  openAiSuccess: 0,
  openAiFailures: 0,
  fallbackCount: 0,
  quotaFailures: 0,
  timeoutFailures: 0,
  networkFailures: 0,
  offTopicCount: 0,
  noApiKeyCount: 0,
  lastOpenAiSuccessAt: null as Date | null,
  lastFallbackAt: null as Date | null,
  lastFallbackReason: null as LandingAiFallbackReason,
  lastOpenAiHttpStatus: null as number | null,
};

function pct(num: number, den: number): number {
  if (den <= 0) return 0;
  return Math.round((num / den) * 1000) / 10;
}

export function isOutageKnowledgeFallback(reason: LandingAiFallbackReason): boolean {
  return (
    reason === "no_api_key" ||
    reason === "daily_budget" ||
    reason === "openai_http_error" ||
    reason === "openai_empty" ||
    reason === "openai_timeout" ||
    reason === "openai_network"
  );
}

export function recordLandingAiChatOutcome(input: {
  source: LandingAiOutcomeSource;
  fallbackReason: LandingAiFallbackReason;
  httpStatus?: number;
  errorKind?: "timeout" | "network";
}): void {
  state.totalChats += 1;

  if (input.source === "openai") {
    state.openAiSuccess += 1;
    state.lastOpenAiSuccessAt = new Date();
    state.lastOpenAiHttpStatus = input.httpStatus ?? 200;
    return;
  }

  state.fallbackCount += 1;
  state.lastFallbackAt = new Date();
  state.lastFallbackReason = input.fallbackReason;

  if (input.fallbackReason === "off_topic") {
    state.offTopicCount += 1;
    return;
  }

  if (input.fallbackReason === "no_api_key") {
    state.noApiKeyCount += 1;
    state.openAiFailures += 1;
    return;
  }

  state.openAiFailures += 1;
  if (input.errorKind === "timeout") state.timeoutFailures += 1;
  if (input.errorKind === "network") state.networkFailures += 1;
  if (input.httpStatus === 429) state.quotaFailures += 1;
  if (input.httpStatus != null) state.lastOpenAiHttpStatus = input.httpStatus;
}

export function getLandingAiMetricsSnapshot(): LandingAiMetricsSnapshot {
  const attempts = state.openAiSuccess + state.openAiFailures;
  return {
    totalChats: state.totalChats,
    openAiSuccess: state.openAiSuccess,
    openAiFailures: state.openAiFailures,
    fallbackCount: state.fallbackCount,
    quotaFailures: state.quotaFailures,
    timeoutFailures: state.timeoutFailures,
    networkFailures: state.networkFailures,
    offTopicCount: state.offTopicCount,
    noApiKeyCount: state.noApiKeyCount,
    openAiSuccessRate: pct(state.openAiSuccess, attempts),
    fallbackRate: pct(state.fallbackCount, state.totalChats),
    quotaFailureRate: pct(state.quotaFailures, attempts),
    lastOpenAiSuccessAt: state.lastOpenAiSuccessAt?.toISOString() ?? null,
    lastFallbackAt: state.lastFallbackAt?.toISOString() ?? null,
    lastFallbackReason: state.lastFallbackReason,
    lastOpenAiHttpStatus: state.lastOpenAiHttpStatus,
  };
}

/** Test-only reset. */
export function resetLandingAiMetricsForTests(): void {
  state.totalChats = 0;
  state.openAiSuccess = 0;
  state.openAiFailures = 0;
  state.fallbackCount = 0;
  state.quotaFailures = 0;
  state.timeoutFailures = 0;
  state.networkFailures = 0;
  state.offTopicCount = 0;
  state.noApiKeyCount = 0;
  state.lastOpenAiSuccessAt = null;
  state.lastFallbackAt = null;
  state.lastFallbackReason = null;
  state.lastOpenAiHttpStatus = null;
}
