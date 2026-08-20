import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useRequireAuth } from "../../hooks/useRequireAuth";
import { useSubscriptionEntitlements } from "../../hooks/useSubscriptionEntitlements";
import { LockedFeatureCard } from "../../components/subscription/LockedFeatureCard";
import {
  archiveMyGoal,
  createMyGoal,
  deleteMyGoalById,
  listMyGoals,
  updateMyGoal,
  type EmployeeGoalRow,
  type GoalPeriod,
} from "../../lib/api";
import { logClientError } from "../../lib/clientLog";
import { EmployeeGoalListSkeleton } from "../../components/dashboard/DashboardSectionLoading";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { cn } from "@/lib/utils";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { EmployeeEmptyState } from "../../components/employee/EmployeeEmptyState";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { venueLocalTodayKey, resolveBusinessTimezone } from "../../lib/businessVenueTime";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_MEDIUM_MS,
} from "../../lib/pageSessionCache";

function formatEur(value: number): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(value);
  } catch {
    return `€${value.toFixed(2)}`;
  }
}

const iconBtn =
  "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted/60";

export function EmployeeTipGoalsPage() {
  const { t } = useTranslation();
  const { user, authReady, sessionValidated } = useRequireAuth();
  const { tier, ready, hasFeature } = useSubscriptionEntitlements({
    enabled: authReady && user?.role === "employee",
    role: user?.role === "employee" ? "employee" : null,
  });
  const [loading, setLoading] = useState(true);
  const [goals, setGoals] = useState<EmployeeGoalRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeGoalRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyGoalId, setBusyGoalId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<GoalPeriod>("monthly");
  const [startDate, setStartDate] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await listMyGoals();
      const next = data.goals ?? [];
      setGoals(next);
      setLoadError(null);
      if (user?.id) setPageSessionCache(`employee:goals:${user.id}`, next);
      return next;
    } catch (e) {
      logClientError("EmployeeTipGoalsPage.refresh", e);
      setGoals([]);
      setLoadError(e instanceof Error ? e.message : t("employee.tipGoals.loadFailed"));
      return null;
    }
  }, [t, user?.id]);

  useEffect(() => {
    if (!authReady) return;
    if (sessionValidated && (!user || user.role !== "employee")) {
      setLoading(false);
      return;
    }
    if (!user || user.role !== "employee") return;
    let cancelled = false;
    const cacheKey = `employee:goals:${user.id}`;
    const cached = getPageSessionCache<EmployeeGoalRow[]>(cacheKey, PAGE_CACHE_TTL_MEDIUM_MS);
    if (cached) {
      setGoals(cached);
      setLoading(false);
    }
    (async () => {
      if (!cached) setLoading(true);
      try {
        await refresh();
      } finally {
        if (!cancelled && !cached) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, refresh, sessionValidated, user?.role, user?.id]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setAmount("");
    setPeriod("monthly");
    setStartDate(venueLocalTodayKey(resolveBusinessTimezone()));
    setOpen(true);
  };

  const openEdit = (g: EmployeeGoalRow) => {
    setEditing(g);
    setName(g.name ?? "");
    setAmount(String(g.goalAmount ?? ""));
    setPeriod(g.goalPeriod);
    setStartDate(g.startDate);
    setOpen(true);
  };

  const sortedGoals = useMemo(() => {
    const copy = [...goals];
    copy.sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    });
    return copy;
  }, [goals]);

  const empty = sortedGoals.length === 0;

  const periodLabel = (p: GoalPeriod) => t(`business.period.${p}`);

  const isInitialGoalsLoad = loading && goals.length === 0;

  if (!user || user.role !== "employee") {
    return null;
  }

  if (!ready) {
    return (
      <div className={employeeUi.page}>
        <div className={employeeUi.pageInner}>
          <EmployeePageHeader
            title={t("employee.tipGoals.title")}
            description={t("employee.tipGoals.subtitle").trim() || undefined}
          />
          <EmployeeGoalListSkeleton rows={4} className="mt-6" />
        </div>
      </div>
    );
  }

  if (!hasFeature("employeeGoals")) {
    return (
      <div className={employeeUi.page}>
        <div className={employeeUi.pageInner}>
          <EmployeePageHeader
            title={t("employee.tipGoals.title")}
            description={t("employee.tipGoals.subtitle").trim() || undefined}
          />
          <LockedFeatureCard featureKey="employeeGoals" tier={tier} className="mt-6" />
        </div>
      </div>
    );
  }

  return (
    <div className={employeeUi.page}>
      <div className={employeeUi.pageInner}>
        <EmployeePageHeader
          title={t("employee.tipGoals.title")}
          description={t("employee.tipGoals.subtitle").trim() || undefined}
          backAriaLabel={t("employee.tipGoals.backAria")}
          leading={
            <div className={employeeUi.iconTile}>
              <Target className="h-5 w-5 text-primary" aria-hidden />
            </div>
          }
          actions={
            !isInitialGoalsLoad ? (
              <Button type="button" onClick={openCreate} className={employeeUi.btnPrimary}>
                <Plus className="mr-2 h-4 w-4" />
                {t("employee.tipGoals.newGoal")}
              </Button>
            ) : (
              <span className="dashboard-hero-metric-skeleton__bar block h-10 w-32 rounded-xl" aria-hidden />
            )
          }
        />

        <Card className={cn(employeeUi.cardStatic, "w-full p-0")}>
          <div className={employeeUi.cardHeader}>
            <h2 className={employeeUi.cardTitle}>{t("employee.tipGoals.manageTitle")}</h2>
            {t("employee.tipGoals.manageSubtitle").trim() ? (
              <p className={employeeUi.cardDesc}>{t("employee.tipGoals.manageSubtitle")}</p>
            ) : null}
          </div>

          {isInitialGoalsLoad ? (
            <EmployeeGoalListSkeleton rows={4} />
          ) : loadError ? (
            <div className="px-5 py-8 sm:px-6">
              <div className="rounded-2xl border border-border bg-muted/35 p-5">
                <p className="text-sm font-semibold text-foreground">{t("employee.tipGoals.couldNotLoad")}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{loadError}</p>
                <div className="mt-4 flex gap-2">
                  <Button type="button" variant="outline" className={employeeUi.btnSecondary} onClick={() => void refresh()}>
                    {t("employee.tipGoals.retry")}
                  </Button>
                </div>
              </div>
            </div>
          ) : empty ? (
            <EmployeeEmptyState
              icon={<Target className="h-6 w-6" aria-hidden />}
              title={t("employee.tipGoals.emptyTitle")}
              description={t("employee.tipGoals.emptySubtitle")}
            />
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/35 text-left">
                    <th className="whitespace-nowrap px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-6">
                      {t("employee.tipGoals.colName")}
                    </th>
                    <th className="whitespace-nowrap px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-6">
                      {t("employee.tipGoals.colTarget")}
                    </th>
                    <th className="whitespace-nowrap px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-6">
                      {t("employee.tipGoals.colPeriod")}
                    </th>
                    <th className="whitespace-nowrap px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-6">
                      {t("employee.tipGoals.colActions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedGoals.map((g) => (
                    <tr key={g.id} className="border-t border-border/90">
                      <td className="px-5 py-4 font-medium text-foreground sm:px-6">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{g.name}</span>
                          {g.status === "archived" ? (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                              {t("employee.tipGoals.statusArchived")}
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              {t("employee.tipGoals.statusActive")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 tabular-nums text-foreground sm:px-6">
                        {formatEur(Number(g.goalAmount) || 0)}
                      </td>
                      <td className="px-5 py-4 text-foreground sm:px-6">{periodLabel(g.goalPeriod)}</td>
                      <td className="px-5 py-4 sm:px-6">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(g)}
                            className={iconBtn}
                            aria-label={t("employee.tipGoals.editAria")}
                            disabled={busyGoalId === g.id}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (g.status === "archived") return;
                              if (!window.confirm(t("employee.tipGoals.confirmArchive"))) return;
                              setBusyGoalId(g.id);
                              void (async () => {
                                try {
                                  await archiveMyGoal(g.id);
                                  await refresh();
                                } catch (e) {
                                  logClientError("EmployeeTipGoalsPage.archive", e);
                                } finally {
                                  setBusyGoalId(null);
                                }
                              })();
                            }}
                            className={cn(iconBtn, g.status === "archived" && "cursor-not-allowed opacity-40")}
                            aria-label={t("employee.tipGoals.archiveAria")}
                            disabled={busyGoalId === g.id || g.status === "archived"}
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!window.confirm(t("employee.tipGoals.confirmDelete"))) return;
                              setBusyGoalId(g.id);
                              void (async () => {
                                try {
                                  await deleteMyGoalById(g.id);
                                  await refresh();
                                } catch (e) {
                                  logClientError("EmployeeTipGoalsPage.delete", e);
                                } finally {
                                  setBusyGoalId(null);
                                }
                              })();
                            }}
                            className={cn(iconBtn, "text-red-500 hover:bg-red-50")}
                            aria-label={t("employee.tipGoals.deleteAria")}
                            disabled={busyGoalId === g.id}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="rounded-2xl border-border sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? t("employee.tipGoals.dialogEdit") : t("employee.tipGoals.dialogCreate")}</DialogTitle>
              <DialogDescription>{t("employee.tipGoals.dialogDesc")}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="goal-name">{t("employee.tipGoals.labelName")}</Label>
                <Input
                  id="goal-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("employee.tipGoals.placeholderName")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-amount">{t("employee.tipGoals.labelAmount")}</Label>
                <Input
                  id="goal-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={t("employee.tipGoals.placeholderAmount")}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("employee.tipGoals.labelPeriod")}</Label>
                <Select value={period} onValueChange={(v) => setPeriod(v as GoalPeriod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">{t("business.period.daily")}</SelectItem>
                    <SelectItem value="weekly">{t("business.period.weekly")}</SelectItem>
                    <SelectItem value="monthly">{t("business.period.monthly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-start">{t("employee.tipGoals.labelStart")}</Label>
                <Input id="goal-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" className={employeeUi.btnSecondary} onClick={() => setOpen(false)}>
                {t("employee.tipGoals.cancel")}
              </Button>
              <Button
                type="button"
                disabled={saving}
                className={employeeUi.btnPrimary}
                onClick={() => {
                  const n = parseFloat(amount);
                  if (!name.trim()) return;
                  if (Number.isNaN(n) || n < 0) return;
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate.trim())) return;
                  setSaving(true);
                  void (async () => {
                    try {
                      if (editing) {
                        await updateMyGoal(editing.id, {
                          name: name.trim(),
                          goalAmount: n,
                          goalPeriod: period,
                          startDate: startDate.trim(),
                        });
                      } else {
                        await createMyGoal({
                          name: name.trim(),
                          goalAmount: n,
                          goalPeriod: period,
                          startDate: startDate.trim(),
                        });
                      }
                      setOpen(false);
                      await refresh();
                    } catch (e) {
                      logClientError("EmployeeTipGoalsPage.saveGoal", e);
                    } finally {
                      setSaving(false);
                    }
                  })();
                }}
              >
                {t("employee.tipGoals.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
