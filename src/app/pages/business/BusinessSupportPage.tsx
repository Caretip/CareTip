import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import {
  createBusinessSupportTicket,
  fetchBusinessSupportTickets,
  type SupportTicketCategory,
  type SupportTicketStatus,
  type SupportTicketSummary,
} from "@/app/lib/api";
import { useRequireAuth } from "@/app/hooks/useRequireAuth";
import { SupportStatusBadge } from "@/app/components/support/supportTicketUi";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { cn } from "@/lib/utils";
import { DashboardListSkeleton, InlineSpinner } from "@/app/components/dashboard/DashboardSectionLoading";
import { BusinessSubPageShellSkeleton } from "@/app/components/dashboard/BusinessSubPageShellSkeleton";
import { useBusinessPageBoot } from "@/app/lib/useBusinessPageBoot";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_MEDIUM_MS,
} from "@/app/lib/pageSessionCache";

const CATEGORIES: SupportTicketCategory[] = [
  "technical",
  "billing",
  "feature_request",
  "general",
];

const STATUSES: Array<SupportTicketStatus | ""> = ["", "OPEN", "PENDING", "RESOLVED", "CLOSED"];

export function BusinessSupportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, authReady, authStatus } = useRequireAuth();
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | "">("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<SupportTicketCategory>("general");
  const [message, setMessage] = useState("");

  const canLoad =
    authReady && authStatus === "authenticated" && user?.role === "business";

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadTickets = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!canLoad || !user?.id) return;
    const quiet = opts?.quiet === true;
    const cacheKey = `business:support:${user.id}:${statusFilter}:${debouncedSearch.toLowerCase()}`;
    const cached = getPageSessionCache<SupportTicketSummary[]>(cacheKey, PAGE_CACHE_TTL_MEDIUM_MS);
    const useCachedFirst = !quiet && cached !== null;
    if (useCachedFirst) {
      setTickets(cached);
      setLoading(false);
    } else if (!quiet) {
      setLoading(true);
      setTickets([]);
    }
    try {
      const res = await fetchBusinessSupportTickets({
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
      });
      setTickets(res.tickets);
      setPageSessionCache(cacheKey, res.tickets);
    } catch {
      if (!useCachedFirst) toast.error(t("support.business.loadError"));
    } finally {
      if (!quiet && !useCachedFirst) setLoading(false);
    }
  }, [canLoad, debouncedSearch, statusFilter, t, user?.id]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canLoad) return;
    setSubmitting(true);
    try {
      const { ticket } = await createBusinessSupportTicket({ subject, category, message });
      toast.success(t("support.business.createdToast", { number: ticket.ticketNumber }));
      setSubject("");
      setMessage("");
      setCategory("general");
      navigate(`/dashboard/support/${ticket.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("support.business.submitError");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const isInitialTicketLoad = loading && tickets.length === 0;
  const isBackgroundTicketRefresh = loading && tickets.length > 0;
  const { showInitialSkeleton } = useBusinessPageBoot("support", isInitialTicketLoad);

  if (!user || user.role !== "business") return <BusinessSubPageShellSkeleton narrow />;

  return (
    <main className="bg-background px-4 pb-20 pt-5 sm:px-6 lg:px-8">
      <div className="dashboard-page-narrow mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <div className="mb-2 flex items-center gap-2 text-muted-foreground">
            <MessageSquarePlus className="h-5 w-5 shrink-0 text-accent" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wide">
              {t("support.business.eyebrow")}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {t("support.business.title")}
          </h1>
          <p className={cn("mt-2 max-w-2xl", businessUi.cardDesc)}>{t("support.business.subtitle")}</p>
        </header>

        <section className={cn("mb-10 rounded-xl border p-5 sm:p-6", businessUi.cardStatic)}>
          <h2 className="text-lg font-semibold text-foreground">{t("support.business.formTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("support.business.formHint")}</p>
          <form className="mt-5 space-y-4" onSubmit={(e) => void onSubmit(e)}>
            <div className="space-y-2">
              <Label htmlFor="support-subject">{t("support.business.subject")}</Label>
              <Input
                id="support-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={256}
                required
                minLength={3}
                placeholder={t("support.business.subjectPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-category">{t("support.business.category")}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as SupportTicketCategory)}>
                <SelectTrigger id="support-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`support.categories.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-message">{t("support.business.message")}</Label>
              <Textarea
                id="support-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                minLength={10}
                rows={5}
                placeholder={t("support.business.messagePlaceholder")}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {t("support.business.submit")}
            </Button>
          </form>
        </section>

        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">{t("support.business.historyTitle")}</h2>
            <div className="flex flex-wrap gap-2">
              <Input
                className="h-9 w-40 sm:w-52"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("support.business.searchPlaceholder")}
                aria-label={t("support.business.searchAria")}
              />
              <Select
                value={statusFilter || "all"}
                onValueChange={(v) => setStatusFilter(v === "all" ? "" : (v as SupportTicketStatus))}
              >
                <SelectTrigger className="h-9 w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s || "all"} value={s || "all"}>
                      {s ? t(`support.status.${s}`) : t("support.filters.allStatuses")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

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

          {showInitialSkeleton ? (
            <DashboardListSkeleton rows={4} minHeightClass="min-h-0 py-4" />
          ) : tickets.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              {t("support.business.emptyHistory")}
            </p>
          ) : (
            <ul className="space-y-2">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    to={`/dashboard/support/${ticket.id}`}
                    className={cn(
                      "block rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-shadow hover:shadow-md",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span>
                      <SupportStatusBadge status={ticket.status} />
                    </div>
                    <p className="mt-1 text-sm font-semibold text-foreground">{ticket.subject}</p>
                    {ticket.lastMessagePreview ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {ticket.lastMessagePreview}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
