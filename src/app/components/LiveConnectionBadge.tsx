import { useTranslation } from "react-i18next";
import type { SocketConnectionStatus } from "../hooks/useSocket";
import type { PublicSocketStatus } from "../hooks/usePublicSocket";
import { cn } from "@/lib/utils";

type Status = SocketConnectionStatus | PublicSocketStatus;

export function LiveConnectionBadge({
  status,
  className = "",
}: {
  status: Status;
  className?: string;
}) {
  const { t } = useTranslation();
  const label =
    status === "connected"
      ? t("status.live")
      : t(`dashboard.socket.${status}`, { defaultValue: t("dashboard.socket.idle") });
  const ok = status === "connected";
  const warn = status === "disconnected" || status === "reconnecting" || status === "connecting";

  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        ok
          ? "text-foreground"
          : warn
            ? "text-muted-foreground"
            : "text-muted-foreground",
        className,
      )}
    >
      {ok ? (
        <span className="relative inline-flex h-2.5 w-2.5 flex-none items-center justify-center" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      ) : (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            warn ? "animate-pulse bg-amber-500" : "bg-muted-foreground",
          )}
          aria-hidden
        />
      )}
      {label}
    </span>
  );
}
