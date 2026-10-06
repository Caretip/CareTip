import { Bell, Check } from "lucide-react";
import { memo, useCallback, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";
import { getNotificationCategoryStyle } from "@/app/lib/notificationInboxUi";
import type { NotificationCategory } from "@/app/lib/notificationNavigation";
import { cn } from "@/lib/utils";

export type NotificationAlertItem = {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  /** @deprecated Bell dropdown uses category icons instead of initials. */
  initials?: string;
  category?: NotificationCategory;
};

export type NotificationAlertDialogLabels = {
  trigger?: string;
  title: string;
  unreadSummary: (count: number) => string;
  markAllRead: string;
  close: string;
  viewAll: string;
  empty: string;
  emptyHint?: string;
  loadError?: string;
  retry?: string;
  readLabel: string;
};

export type NotificationAlertDialogProps = {
  items: NotificationAlertItem[];
  unreadCount: number;
  loading?: boolean;
  listError?: string | null;
  open: boolean;
  className?: string;
  trigger?: ReactNode;
  previewCount?: number;
  labels: NotificationAlertDialogLabels;
  onOpenChange: (open: boolean) => void;
  onViewAll: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onItemActivate?: (id: string) => void;
  onRetryList?: () => void;
};

const NotificationRow = memo(function NotificationRow({
  notification,
  onSelect,
  readLabel,
}: {
  notification: NotificationAlertItem;
  onSelect: () => void;
  readLabel: string;
}) {
  const category = notification.category ?? "system";
  const style = getNotificationCategoryStyle(category);
  const Icon = style.icon;

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "caretip-notification-panel__row",
        notification.read ? "caretip-notification-panel__row--read" : "caretip-notification-panel__row--unread",
      )}
      onClick={onSelect}
    >
      <div className={cn("caretip-notification-panel__icon", style.bgClass)} aria-hidden>
        <Icon className={cn("h-4 w-4", style.iconClass)} />
      </div>
      <div className="caretip-notification-panel__body">
        <div className="caretip-notification-panel__row-top">
          <p className="caretip-notification-panel__row-title">{notification.title}</p>
          <time className="caretip-notification-panel__time" dateTime={notification.time}>
            {notification.time}
          </time>
        </div>
        <p className="caretip-notification-panel__message">{notification.message}</p>
        {notification.read ? (
          <span className="caretip-notification-panel__read-meta">
            <Check className="h-3 w-3 shrink-0" aria-hidden />
            {readLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
});

/**
 * Bell notification panel — Popover (not modal AlertDialog) so open feels instant
 * and anchored to the trigger without a full-screen overlay wait.
 */
export function NotificationAlertDialog({
  items,
  unreadCount,
  loading = false,
  listError = null,
  open,
  className,
  trigger,
  previewCount = 5,
  labels,
  onOpenChange,
  onViewAll,
  onMarkRead,
  onMarkAllRead,
  onItemActivate,
  onRetryList,
}: NotificationAlertDialogProps) {
  const handleViewAll = useCallback(() => {
    onOpenChange(false);
    onViewAll();
  }, [onOpenChange, onViewAll]);

  const handleMarkAllRead = useCallback(() => {
    onMarkAllRead();
  }, [onMarkAllRead]);

  const handleSelect = useCallback(
    (id: string) => {
      onMarkRead(id);
      onItemActivate?.(id);
    },
    [onMarkRead, onItemActivate],
  );

  const previewItems = items.slice(0, previewCount);
  const summaryLine = labels.unreadSummary(unreadCount);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            className={cn(
              "relative bg-primary pr-6 text-primary-foreground hover:bg-primary/90",
              className,
            )}
          >
            <Bell className="mr-1 h-5 w-5" aria-hidden />
            {labels.trigger ?? "Notifications"}
            {unreadCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(
          "caretip-notification-panel caretip-notification-panel--premium flex max-h-[min(92dvh,34rem)] w-[min(100vw-2rem,28rem)] flex-col gap-0 overflow-hidden p-0",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          "data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1",
          "duration-150 origin-[var(--radix-popover-content-transform-origin)]",
        )}
      >
        <header className="caretip-notification-panel__header shrink-0">
          <div className="flex items-start justify-between gap-3">
            <h2 className="caretip-notification-panel__title">{labels.title}</h2>
            <button
              type="button"
              className="caretip-notification-panel__mark-all shrink-0 rounded-md px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0}
            >
              {labels.markAllRead}
            </button>
          </div>
          <p className="caretip-notification-panel__summary">{summaryLine}</p>
        </header>

        <div className="caretip-notification-panel__scroll min-h-0 flex-1" aria-live="polite">
          {loading ? (
            <div aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="caretip-notification-panel__skeleton" />
              ))}
            </div>
          ) : previewItems.length === 0 && (listError || unreadCount > 0) ? (
            <div className="caretip-notification-panel__empty">
              <p className="caretip-notification-panel__empty-hint">
                {labels.loadError ?? listError ?? labels.empty}
              </p>
              {onRetryList ? (
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetryList}>
                  {labels.retry ?? "Retry"}
                </Button>
              ) : null}
            </div>
          ) : previewItems.length === 0 ? (
            <div className="caretip-notification-panel__empty">
              <div className="caretip-notification-panel__empty-icon" aria-hidden>
                <Bell className="h-4 w-4" />
              </div>
              <p className="caretip-notification-panel__empty-title">{labels.empty}</p>
              {labels.emptyHint ? (
                <p className="caretip-notification-panel__empty-hint">{labels.emptyHint}</p>
              ) : null}
            </div>
          ) : (
            previewItems.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                readLabel={labels.readLabel}
                onSelect={() => handleSelect(notification.id)}
              />
            ))
          )}
        </div>

        <footer className="caretip-notification-panel__footer shrink-0">
          <button
            type="button"
            className="caretip-notification-panel__close rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onOpenChange(false)}
          >
            {labels.close}
          </button>
          <Button
            type="button"
            className="caretip-notification-panel__view-all bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleViewAll}
          >
            {labels.viewAll}
          </Button>
        </footer>
      </PopoverContent>
    </Popover>
  );
}
