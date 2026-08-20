import type { SupportTicketStatus } from "@prisma/client";
import {
  deliverNotificationToUsers,
  deliverUserNotification,
} from "./notifications/notificationOrchestrator.service.js";
import { NotificationType } from "./push/notification.types.js";
import { listPlatformAdminUserIds } from "./push/notification.triggers.js";
import type { SupportTicketDetailDto } from "./supportTicket.service.js";

function adminTicketUrl(ticketId: string): string {
  return `/platform-admin/support/${ticketId}`;
}

function businessTicketUrl(ticketId: string): string {
  return `/dashboard/support/${ticketId}`;
}

export function notifySupportTicketCreated(params: {
  ticket: SupportTicketDetailDto;
  businessName: string;
  managerUserId: string;
}): void {
  const { ticket, businessName, managerUserId } = params;

  void listPlatformAdminUserIds().then((adminIds) => {
    if (adminIds.length === 0) return;
    void deliverNotificationToUsers(
      adminIds,
      {
        type: NotificationType.SUPPORT_TICKET_CREATED,
        title: `[TICKET] ${ticket.ticketNumber}`,
        body: "",
        localeTemplate: {
          id: "support_created_admin",
          params: {
            ticketNumber: ticket.ticketNumber,
            businessName,
            category: ticket.category,
          },
        },
        url: adminTicketUrl(ticket.id),
        timestamp: new Date().toISOString(),
        metadata: {
          entityId: ticket.id,
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          status: ticket.status,
          category: ticket.category,
          businessId: ticket.businessId,
        },
      },
      {
        dedupeKeyPrefix: `support_created:${ticket.id}`,
        channels: { in_app: true, push: true, email: true },
        priority: "high",
      },
    );
  });

  void deliverUserNotification({
    userId: managerUserId,
    payload: {
      type: NotificationType.SUPPORT_TICKET_CREATED,
      title: `Support request received: ${ticket.ticketNumber}`,
      body: "",
      localeTemplate: {
        id: "support_created_business",
        params: {
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
        },
      },
      url: businessTicketUrl(ticket.id),
      timestamp: new Date().toISOString(),
      metadata: {
        entityId: ticket.id,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
      },
    },
    dedupeKey: `support_created_biz:${ticket.id}:${managerUserId}`,
    channels: { in_app: true, push: true, email: false },
  });
}

export function notifySupportTicketReply(params: {
  ticket: SupportTicketDetailDto;
  businessName: string;
  managerUserId: string;
  repliedBy: "business" | "admin";
  preview: string;
  /** Unique message id — required so each reply is a distinct notification. */
  messageId: string;
}): void {
  const { ticket, businessName, managerUserId, repliedBy, preview, messageId } = params;
  const msgKey = messageId.trim() || `t${Date.now()}`;

  if (repliedBy === "business") {
    void listPlatformAdminUserIds().then((adminIds) => {
      if (adminIds.length === 0) return;
      void deliverNotificationToUsers(
        adminIds,
        {
          type: NotificationType.SUPPORT_TICKET_REPLY,
          title: `[TICKET] New reply: ${ticket.ticketNumber}`,
          body: "",
          localeTemplate: {
            id: "support_reply_admin",
            params: {
              ticketNumber: ticket.ticketNumber,
              businessName,
              preview,
            },
          },
          url: adminTicketUrl(ticket.id),
          timestamp: new Date().toISOString(),
          metadata: {
            entityId: ticket.id,
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            status: ticket.status,
            messageId: msgKey,
          },
        },
        {
          dedupeKeyPrefix: `support_reply:${ticket.id}:msg:${msgKey}:business`,
          channels: { in_app: true, push: true, email: false },
        },
      );
    });
    return;
  }

  void deliverUserNotification({
    userId: managerUserId,
    payload: {
      type: NotificationType.SUPPORT_TICKET_REPLY,
      title: `CareTip replied: ${ticket.ticketNumber}`,
      body: "",
      localeTemplate: {
        id: "support_reply_business",
        params: {
          ticketNumber: ticket.ticketNumber,
          preview,
        },
      },
      url: businessTicketUrl(ticket.id),
      timestamp: new Date().toISOString(),
      metadata: {
        entityId: ticket.id,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        messageId: msgKey,
      },
    },
    dedupeKey: `support_reply:${ticket.id}:msg:${msgKey}:admin:${managerUserId}`,
    channels: { in_app: true, push: true, email: true },
  });
}

export function notifySupportTicketStatus(params: {
  ticket: SupportTicketDetailDto;
  businessName: string;
  managerUserId: string;
  previousStatus: SupportTicketStatus;
}): void {
  const { ticket, managerUserId, previousStatus } = params;
  if (previousStatus === ticket.status) return;

  const localeTemplate =
    ticket.status === "RESOLVED"
      ? ({ id: "support_status_resolved" } as const)
      : ticket.status === "CLOSED"
        ? ({ id: "support_status_closed" } as const)
        : ({
            id: "support_status_updated",
            params: { status: ticket.status },
          } as const);

  void deliverUserNotification({
    userId: managerUserId,
    payload: {
      type: NotificationType.SUPPORT_TICKET_STATUS,
      title: `[TICKET] ${ticket.ticketNumber}`,
      body: "",
      localeTemplate,
      url: businessTicketUrl(ticket.id),
      timestamp: new Date().toISOString(),
      metadata: {
        entityId: ticket.id,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
      },
    },
    dedupeKey: `support_status:${ticket.id}:${ticket.status}:${managerUserId}`,
    channels: {
      in_app: true,
      push: true,
      email: ticket.status === "RESOLVED" || ticket.status === "CLOSED",
    },
  });
}
