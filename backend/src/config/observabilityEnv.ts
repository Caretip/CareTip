import { isSentryConfigured } from "../instrument/sentry.js";
import { getScheduledPayoutTickHeartbeatDiagnostics } from "../services/scheduledBankPayoutTickHeartbeat.js";

export type ObservabilityHealthDiagnostics = {
  sentryConfigured: boolean;
  scheduledPayoutTick: ReturnType<typeof getScheduledPayoutTickHeartbeatDiagnostics>;
};

export function getObservabilityHealthDiagnostics(): ObservabilityHealthDiagnostics {
  return {
    sentryConfigured: isSentryConfigured(),
    scheduledPayoutTick: getScheduledPayoutTickHeartbeatDiagnostics(),
  };
}
