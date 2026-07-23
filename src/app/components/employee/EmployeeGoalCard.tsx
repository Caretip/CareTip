import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { CheckCircle2, Pencil, Plus, Trash2, Target, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  upsertEmployeeGoal,
  deleteEmployeeGoal,
  type EmployeeGoalProgress,
  type GoalPeriod,
} from "../../lib/api";
import { formatEur } from "../../lib/formatEur";
import { venueLocalTodayKey, resolveBusinessTimezone } from "../../lib/businessVenueTime";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { employeeUi } from "./employeeDashboardUi";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";

const PERIOD_LABEL_KEYS: Record<GoalPeriod, string> = {
  daily: "business.period.daily",
  weekly: "business.period.weekly",
  monthly: "business.period.monthly",
};

const STATUS_LABEL_KEYS: Record<EmployeeGoalProgress["status"], string> = {
  achieved: "business.goalStatus.achieved",
  on_track: "business.goalStatus.on_track",
  below_target: "business.goalStatus.below_target",
};

function statusClass(s: EmployeeGoalProgress["status"]): string {
  if (s === "achieved") return "text-[#34D399]";
  if (s === "on_track") return "text-primary";
  return "text-amber-700";
}

export type EmployeeGoalCardHandle = {
  createNewGoal: () => void;
  editGoal: () => void;
};

type Props = {
  goal: EmployeeGoalProgress | null;
  onUpdated: () => void;
  /** When false, hides the inline "New goal" action (use page-level button instead). */
  showInlineNewGoalAction?: boolean;
};

export const EmployeeGoalCard = forwardRef<EmployeeGoalCardHandle, Props>(function EmployeeGoalCard(
  { goal, onUpdated, showInlineNewGoalAction = true }: Props,
  ref,
) {
  const { t } = useTranslation();
  const periodLabel = useMemo(
    () =>
      ({
        daily: t(PERIOD_LABEL_KEYS.daily),
        weekly: t(PERIOD_LABEL_KEYS.weekly),
        monthly: t(PERIOD_LABEL_KEYS.monthly),
      }) satisfies Record<GoalPeriod, string>,
    [t],
  );
  const statusLabel = useMemo(
    () =>
      ({
        achieved: t(STATUS_LABEL_KEYS.achieved),
        on_track: t(STATUS_LABEL_KEYS.on_track),
        below_target: t(STATUS_LABEL_KEYS.below_target),
      }) satisfies Record<EmployeeGoalProgress["status"], string>,
    [t],
  );

  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markingAchieved, setMarkingAchieved] = useState(false);
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<GoalPeriod>("monthly");
  const [startDate, setStartDate] = useState("");

  const openEdit = () => {
    if (goal) {
      setAmount(String(goal.goalAmount));
      setPeriod(goal.goalPeriod);
      setStartDate(goal.startDate);
    } else {
      setAmount("");
      setPeriod("monthly");
      setStartDate(venueLocalTodayKey(resolveBusinessTimezone()));
    }
    setOpen(true);
  };

  const openCreateNew = () => {
    setAmount("");
    setPeriod("monthly");
    setStartDate(venueLocalTodayKey(resolveBusinessTimezone()));
    setOpen(true);
  };

  useImperativeHandle(
    ref,
    () => ({
      createNewGoal: openCreateNew,
      editGoal: openEdit,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable enough for imperative handle
    [goal],
  );

  const handleSave = async () => {
    const n = parseFloat(amount);
    if (Number.isNaN(n) || n < 0) {
      toast.error(t("employee.goalCard.toastInvalidAmount"));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate.trim())) {
      toast.error(t("employee.goalCard.toastInvalidStartDate"));
      return;
    }
    setSaving(true);
    try {
      await upsertEmployeeGoal({
        goalAmount: n,
        goalPeriod: period,
        startDate: startDate.trim(),
      });
      setOpen(false);
      onUpdated();
    } catch (e) {
      logClientError("EmployeeGoalCard.save", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!goal) return;
    const ok = window.confirm(t("employee.goalCard.confirmRemove"));
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteEmployeeGoal();
      setOpen(false);
      onUpdated();
    } catch (e) {
      logClientError("EmployeeGoalCard.delete", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const handleMarkAchieved = async () => {
    if (!goal) return;
    // Persisted behavior: we "lock in" achieved by setting the stored goalAmount
    // to the currentAmount for the active period. Status is computed server-side.
    const nextAmount = Number(goal.currentAmount);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      toast.error(t("employee.goalCard.toastNoProgress"));
      return;
    }
    setMarkingAchieved(true);
    try {
      await upsertEmployeeGoal({
        goalAmount: nextAmount,
        goalPeriod: goal.goalPeriod,
        startDate: goal.startDate,
      });
      onUpdated();
    } catch (e) {
      logClientError("EmployeeGoalCard.markAchieved", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setMarkingAchieved(false);
    }
  };

  return (
    <>
      <Card className={cn(employeeUi.card, "w-full rounded-2xl")}>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary p-2 text-primary-foreground">
              <Target className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base">Tip goal</CardTitle>
              {goal && goal.goalAmount > 0 ? (
                <>
                  <CardDescription className="mt-1 flex flex-wrap items-baseline gap-x-1.5 break-words text-foreground/90">
                    <span className="min-w-0 font-semibold tabular-nums">
                      {formatEur(goal.currentAmount)} / {formatEur(goal.goalAmount)}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      ({Math.round(Number(goal.percent))}%)
                    </span>
                  </CardDescription>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {periodLabel[goal.goalPeriod]} · since {goal.startDate}
                  </p>
                  <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-background">
                    <div
                      className="h-3 rounded-full bg-primary transition-all"
                      style={{ width: `${Math.min(100, goal.percent)}%` }}
                    />
                  </div>
                  <p className={`mt-2 text-xs font-medium ${statusClass(goal.status)}`}>
                    {statusLabel[goal.status]}
                  </p>
                </>
              ) : (
                <CardDescription className="mt-1">
                  Set a target for your tips. You can pick daily, weekly, or monthly.
                </CardDescription>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {goal ? (
                  <>
                    <Button type="button" size="sm" variant="default" onClick={openEdit}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    {showInlineNewGoalAction ? (
                      <Button type="button" size="sm" variant="outline" onClick={openCreateNew}>
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        New goal
                      </Button>
                    ) : null}
                    {goal.status !== "achieved" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void handleMarkAchieved()}
                        disabled={markingAchieved}
                      >
                        {markingAchieved ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            Mark achieved
                          </>
                        )}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <Button type="button" size="sm" variant="default" onClick={openEdit}>
                    Create goal
                  </Button>
                )}
                {goal ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Delete
                      </>
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{goal ? "Edit tip goal" : "Create tip goal"}</DialogTitle>
            <DialogDescription>
              Progress uses successful tips in the current {periodLabel[period].toLowerCase()} period
              (from your start date).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="goal-amount">Target amount (€)</Label>
              <Input
                id="goal-amount"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="300"
              />
            </div>
            <div className="space-y-2">
              <Label>Period</Label>
              <Select value={period} onValueChange={(v) => setPeriod(v as GoalPeriod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-start">Start date</Label>
              <Input
                id="goal-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save goal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
