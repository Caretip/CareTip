/**
 * Idle / unsaved session warning dialog (presentational).
 * Checkpoint 3: idle warning + Stay / Log out wiring via callbacks.
 * Auth logout is provided by the parent (Checkpoint 4).
 */

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import type { IdleUiPhase } from "../lib/idleSessionStore";

export type IdleWarningModalProps = {
  open: boolean;
  phase: Exclude<IdleUiPhase, "none">;
  secondsRemaining: number;
  onStaySignedIn: () => void;
  onLogOut: () => void;
};

function shouldAnnounceCountdown(seconds: number, previous: number | null): boolean {
  if (previous === null) return true;
  if (seconds === 0) return true;
  if (seconds === 60 || seconds === 30 || seconds === 10) return true;
  return false;
}

export function IdleWarningModal({
  open,
  phase,
  secondsRemaining,
  onStaySignedIn,
  onLogOut,
}: IdleWarningModalProps) {
  const { t } = useTranslation();
  const liveId = useId();
  const prevSeconds = useRef<number | null>(null);
  const [liveText, setLiveText] = useState("");

  const isUnsaved = phase === "unsaved-grace";
  const seconds = Math.max(0, Math.floor(secondsRemaining));

  useEffect(() => {
    if (!open) {
      prevSeconds.current = null;
      setLiveText("");
      return;
    }
    if (shouldAnnounceCountdown(seconds, prevSeconds.current)) {
      setLiveText(t("idleSession.countdownLive", { seconds }));
    }
    prevSeconds.current = seconds;
  }, [open, seconds, t]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Escape / dismiss → Stay signed in (Phase 2 §6.7).
        if (!next && open) onStaySignedIn();
      }}
    >
      <AlertDialogContent
        className="motion-reduce:animate-none border-orange-200/80 sm:max-w-md"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onStaySignedIn();
        }}
        aria-describedby={liveId}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isUnsaved ? t("idleSession.unsavedTitle") : t("idleSession.warningTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isUnsaved
              ? t("idleSession.unsavedBody", { seconds })
              : t("idleSession.warningBody", { seconds })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <p id={liveId} className="sr-only" aria-live="polite" aria-atomic="true">
          {liveText}
        </p>

        <p
          className="text-center text-2xl font-semibold tabular-nums text-foreground"
          aria-hidden="true"
        >
          {seconds}s
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel
            type="button"
            className="text-destructive hover:text-destructive"
            onClick={(event) => {
              event.preventDefault();
              onLogOut();
            }}
          >
            {isUnsaved ? t("idleSession.logOutAnyway") : t("idleSession.logOutNow")}
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            autoFocus
            className="bg-[color:var(--brand-primary,#c45c26)] text-white hover:bg-[color:var(--brand-primary,#c45c26)]/90"
            onClick={(event) => {
              event.preventDefault();
              onStaySignedIn();
            }}
          >
            {t("idleSession.staySignedIn")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
