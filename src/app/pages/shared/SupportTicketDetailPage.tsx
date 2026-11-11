import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation, useParams } from "react-router";
import { toast } from "sonner";
import {
  fetchBusinessSupportTicket,
  fetchPlatformSupportTicket,
  replyBusinessSupportTicket,
  replyPlatformSupportTicket,
  updatePlatformSupportTicketStatus,
  type SupportTicketDetail,
  type SupportTicketStatus,
} from "@/app/lib/api";
import { useRequireAuth } from "@/app/hooks/useRequireAuth";
import { SupportStatusBadge } from "@/app/components/support/supportTicketUi";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { dashboardSharedUi } from "@/app/components/dashboard/dashboardSharedUi";
import {
  DashboardListSkeleton,
  InlineSpinner,
} from "@/app/components/dashboard/DashboardSectionLoading";
import { cn } from "@/lib/utils";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_MEDIUM_MS,
} from "@/app/lib/pageSessionCache";
import { toDisplayErrorMessage } from "@/app/lib/errorMessages";

const ADMIN_STATUSES: SupportTicketStatus[] = ["OPEN", "PENDING", "RESOLVED", "CLOSED"];

function SupportTicketHeaderSkeleton() {
  return (
    <header className="mb-6" aria-hidden>
      <div className="flex flex-wrap items-center gap-2">
        <span className="dashboard-hero-metric-skeleton__bar h-6 w-16 rounded-md" />
        <span className="dashboard-hero-metric-skeleton__bar h-6 w-20 rounded-full" />
        <span className="dashboard-hero-metric-skeleton__bar h-4 w-24 rounded-md" />
      </div>
      <span className="dashboard-hero-metric-skeleton__bar mt-3 block h-8 w-[min(100%,24rem)] rounded-md" />
      <span className="dashboard-hero-metric-skeleton__bar mt-2 block h-4 w-40 rounded-md" />
    </header>
  );
}

export function SupportTicketDetailPage() {
  const { t, i18n } = useTranslation();
  const { ticketId } = useParams<{ ticketId: string }>();
  const location = useLocation();
  const { user, authHydrated, sessionValidated } = useRequireAuth();
  const isAdmin = location.pathname.startsWith("/platform-admin/support");
  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const ticketRef = useRef<SupportTicketDetail | null>(null);
  ticketRef.current = ticket;

  const backHref = isAdmin ? "/platform-admin/communication/inbox" : "/dashboard/support";
  const listHref = isAdmin ? "/platform-admin/communication/inbox" : "/dashboard/support";

  const canLoad = authHydrated && sessionValidated && Boolean(user) && Boolean(ticketId);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!ticketId || !canLoad) return;
      const quiet = opts?.quiet === true;
      const cacheKey = `support:ticket:${isAdmin ? "admin" : "business"}:${ticketId}`;
      const cached = getPageSessionCache<SupportTicketDetail>(cacheKey, PAGE_CACHE_TTL_MEDIUM_MS);
      const useCachedFirst = !quiet && cached !== null;
      if (useCachedFirst) {
        setTicket(cached);
        setLoading(false);
      } else if (!quiet && !ticketRef.current) {
        setLoading(true);
      }
      try {
        const res = isAdmin
          ? await fetchPlatformSupportTicket(ticketId)
          : await fetchBusinessSupportTicket(ticketId);
        setTicket(res.ticket);
        setPageSessionCache(cacheKey, res.ticket);
      } catch {
        if (!useCachedFirst && !ticketRef.current) {
          toast.error(t("support.detail.loadError"));
          setTicket(null);
        }
      } finally {
        if (!quiet && !useCachedFirst) setLoading(false);
      }
    },
    [canLoad, isAdmin, t, ticketId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onSendReply = async () => {
    if (!ticketId || !reply.trim()) return;
    setSending(true);
    try {
      const res = isAdmin
        ? await replyPlatformSupportTicket(ticketId, reply.trim())
        : await replyBusinessSupportTicket(ticketId, reply.trim());
      setTicket(res.ticket);
      const cacheKey = `support:ticket:${isAdmin ? "admin" : "business"}:${ticketId}`;
      setPageSessionCache(cacheKey, res.ticket);
      setReply("");
      toast.success(t("support.detail.replySent"));
    } catch (err) {
      toast.error(toDisplayErrorMessage(err, t("support.detail.replyError")));
    } finally {
      setSending(false);
    }
  };

  const onStatusChange = async (status: SupportTicketStatus) => {
    if (!ticketId || !isAdmin) return;
    setStatusUpdating(true);
    try {
      const res = await updatePlatformSupportTicketStatus(ticketId, status);
      setTicket(res.ticket);
      const cacheKey = `support:ticket:admin:${ticketId}`;
      setPageSessionCache(cacheKey, res.ticket);
      toast.success(t("support.detail.statusUpdated"));
    } catch (err) {
      toast.error(toDisplayErrorMessage(err, t("support.detail.statusError")));
    } finally {
      setStatusUpdating(false);
    }
  };

  if (!authHydrated || !sessionValidated || !user) {
    return null;
  }
  if (!isAdmin && user.role !== "business") {
    return <Navigate to="/unauthorized" replace />;
  }

  const isInitialTicketLoad = loading && !ticket;
  const isBackgroundTicketRefresh = loading && Boolean(ticket);
  const closed = ticket?.status === "CLOSED";

  return (
    <div className={dashboardSharedUi.pageNarrow}>
      <Button type="button" variant="ghost" size="sm" className="mb-4 -ml-2" asChild>
        <Link to={backHref}>
          {isAdmin ? t("support.detail.backInbox") : t("support.detail.backSupport")}
        </Link>
      </Button>

      {isInitialTicketLoad ? (
        <>
          <SupportTicketHeaderSkeleton />
          <DashboardListSkeleton rows={4} minHeightClass="min-h-[12rem]" />
        </>
      ) : !ticket ? (
        <p className="text-sm text-muted-foreground">{t("support.detail.notFound")}</p>
      ) : (
        <>
          {isBackgroundTicketRefresh ? (
            <div
              className="mb-3 flex items-center justify-end gap-2 text-xs font-medium text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <InlineSpinner />
              <span>{t("dashboard.refresh.updating")}</span>
            </div>
          ) : null}

          <header className="mb-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground">
                [TICKET]
              </span>
              <SupportStatusBadge status={ticket.status} />
              <span className="font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span>
            </div>
            <h1 className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">{ticket.subject}</h1>
            {isAdmin ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {ticket.businessName} · {t(`support.categories.${ticket.category}`)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {t(`support.categories.${ticket.category}`)}
              </p>
            )}
            {isAdmin ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("support.detail.statusLabel")}
                </span>
                <Select
                  value={ticket.status}
                  onValueChange={(v) => void onStatusChange(v as SupportTicketStatus)}
                  disabled={statusUpdating}
                >
                  <SelectTrigger className="h-9 w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ADMIN_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`support.status.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </header>

          <ul className="mb-6 space-y-3" aria-label={t("support.detail.threadAria")}>
            {ticket.messages.map((m) => (
              <li
                key={m.id}
                className={cn(
                  "rounded-xl border px-4 py-3 text-sm",
                  m.authorRole === "admin"
                    ? "border-accent/20 bg-accent/[0.05]"
                    : "border-border bg-card",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-medium">
                    {m.authorRole === "admin"
                      ? t("support.detail.authorCareTip")
                      : t("support.detail.authorYou")}
                  </span>
                  <time dateTime={m.createdAt}>
                    {new Date(m.createdAt).toLocaleString(i18n.language, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <p className="whitespace-pre-wrap leading-relaxed text-foreground">{m.body}</p>
              </li>
            ))}
          </ul>

          {!closed ? (
            <div className="space-y-2">
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={4}
                placeholder={t("support.detail.replyPlaceholder")}
                aria-label={t("support.detail.replyAria")}
              />
              <Button type="button" disabled={sending || !reply.trim()} onClick={() => void onSendReply()}>
                {sending ? (
                  <InlineSpinner className="mr-2" />
                ) : (
                  <Send className="mr-2 h-4 w-4" aria-hidden />
                )}
                {t("support.detail.sendReply")}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("support.detail.closedHint")}</p>
          )}

          <p className="mt-6 text-center text-xs text-muted-foreground">
            <Link to={listHref} className="underline-offset-2 hover:underline">
              {isAdmin ? t("support.detail.viewInbox") : t("support.detail.viewAllTickets")}
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
