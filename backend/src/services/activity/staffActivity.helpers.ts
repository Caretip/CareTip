import { ActivityEventSource } from "@prisma/client";
import {
  ACTIVITY_EVENT_TYPES,
  projectBusinessActivityEvent,
} from "./businessActivityEvent.service.js";

/** Track A — shareable invite code created. */
export function scheduleEmployeeInvitedCodeProjection(input: {
  businessId: string;
  inviteId: string;
  inviteCode: string;
  expiresAt: Date;
  actorUserId: string;
}): void {
  projectBusinessActivityEvent({
    businessId: input.businessId,
    type: ACTIVITY_EVENT_TYPES.EMPLOYEE_INVITED,
    source: ActivityEventSource.STAFF,
    occurredAt: new Date(),
    dedupeKey: `invite:${input.inviteId}:created`,
    subjectType: "invite",
    subjectId: input.inviteId,
    actorUserId: input.actorUserId,
    summary: {
      channel: "code",
      inviteCode: input.inviteCode,
      expiresAt: input.expiresAt.toISOString(),
    },
  });
}

/** Track B — dashboard named email invite. */
export function scheduleEmployeeInvitedEmailProjection(input: {
  businessId: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  actorUserId?: string | null;
}): void {
  projectBusinessActivityEvent({
    businessId: input.businessId,
    type: ACTIVITY_EVENT_TYPES.EMPLOYEE_INVITED,
    source: ActivityEventSource.STAFF,
    occurredAt: new Date(),
    dedupeKey: `staff-invite:${input.employeeId}:created`,
    subjectType: "employee",
    subjectId: input.employeeId,
    actorUserId: input.actorUserId ?? null,
    summary: {
      channel: "email",
      employeeName: input.employeeName,
      employeeEmail: input.employeeEmail,
    },
  });
}

/**
 * First transition to activationStatus=active.
 * Shared dedupe: employee:{employeeId}:joined
 */
export function scheduleEmployeeJoinedProjection(input: {
  businessId: string;
  employeeId: string;
  employeeName: string;
  employeeEmail?: string | null;
  channel: "oauth" | "email_verify" | "activate" | "bypass";
}): void {
  projectBusinessActivityEvent({
    businessId: input.businessId,
    type: ACTIVITY_EVENT_TYPES.EMPLOYEE_JOINED,
    source: ActivityEventSource.STAFF,
    occurredAt: new Date(),
    dedupeKey: `employee:${input.employeeId}:joined`,
    subjectType: "employee",
    subjectId: input.employeeId,
    actorEmployeeId: input.employeeId,
    summary: {
      employeeName: input.employeeName,
      employeeEmail: input.employeeEmail ?? null,
      channel: input.channel,
    },
  });
}
