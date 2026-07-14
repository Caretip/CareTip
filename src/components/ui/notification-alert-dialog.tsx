import { BellRing, Check, Clock } from "lucide-react";
import { memo, useCallback, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";
import { cn } from "@/lib/utils";

export type NotificationAlertItem = {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  initials?: string;
};

export type NotificationAlertDialogLabels = {
  trigger?: string;
  title: string;
  unreadSummary: (count: number) => string;
  markAllRead: string;
  close: string;
  viewAll: string;
  empty: string;
  readLabel: string;
};

export type NotificationAlertDialogProps = {
  items: NotificationAlertItem[];
  unreadCount: number;
  loading?: boolean;
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
};

function initialsFromTitle(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

const NotificationRow = memo(function NotificationRow({
  notification,
  onSelect,
  readLabel,
}: {
  notification: NotificationAlertItem;
  onSelect: () => void;
  readLabel: string;
}) {
  const initials = notification.initials ?? initialsFromTitle(notification.title);

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
        "flex w-full min-w-0 cursor-pointer gap-3 overflow-hidden rounded-md p-3 transition-colors duration-150",
        notification.read
          ? "bg-muted/60 hover:bg-muted/80"
          : "border border-primary/15 bg-primary/5 shadow-sm hover:bg-primary/[0.08] dark:bg-primary/10",
      )}
      onClick={onSelect}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-medium",
          notification.read
            ? "bg-muted text-muted-foreground"
            : "bg-primary/15 text-primary dark:bg-primary/25 dark:text-[#f0a84d]",
        )}
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
          <p
            className={cn(
              "min-w-0 truncate text-sm font-medium",
              notification.read ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {notification.title}
          </p>
          <div className="flex shrink-0 items-center whitespace-nowrap text-xs text-muted-foreground">
            <Clock className="mr-1 h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{notification.time}</span>
          </div>
        </div>
        <p className="line-clamp-2 break-words text-xs text-muted-foreground">{notification.message}</p>
        {notification.read ? (
          <div className="mt-1.5 flex items-center text-xs text-primary">
            <Check className="mr-1 h-3 w-3" aria-hidden />
            {readLabel}
          </div>
        ) : null}
      </div>
      {!notification.read ? (
        <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-hidden />
      ) : null}
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
            <BellRing className="mr-1 h-5 w-5" aria-hidden />
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
          "caretip-notification-panel flex max-h-[min(92dvh,32rem)] w-[min(100vw-2rem,28rem)] flex-col gap-0 overflow-hidden border-2 border-primary/20 bg-background p-0 shadow-lg",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          "duration-200 origin-[var(--radix-popover-content-transform-origin)]",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-4">
          <div className="shrink-0 space-y-2 text-left">
            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <BellRing className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                <h2 className="truncate text-lg font-semibold leading-none tracking-tight">
                  {labels.title}
                </h2>
              </div>
              {unreadCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllRead}
                  className="h-auto max-w-full shrink-0 px-2 py-1 text-xs text-primary hover:text-primary/80"
                >
                  <span className="truncate">{labels.markAllRead}</span>
                </Button>
              ) : null}
            </div>
            <p className="break-words text-sm text-muted-foreground">
              {labels.unreadSummary(unreadCount)}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-3">
            <div className="space-y-2">
              {loading ? (
                <div className="space-y-2" aria-busy aria-live="polite">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-[72px] animate-pulse rounded-md bg-muted/80"
                    />
                  ))}
                </div>
              ) : previewItems.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{labels.empty}</p>
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
          </div>
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-stretch">
          <Button
            type="button"
            variant="outline"
            className="mt-0 w-full min-w-0 border-primary/25 text-primary hover:bg-primary/5 sm:flex-1"
            onClick={() => onOpenChange(false)}
          >
            <span className="truncate">{labels.close}</span>
          </Button>
          <Button
            type="button"
            className="w-full min-w-0 bg-primary text-primary-foreground hover:bg-primary/90 sm:flex-1"
            onClick={handleViewAll}
          >
            <span className="truncate">{labels.viewAll}</span>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
