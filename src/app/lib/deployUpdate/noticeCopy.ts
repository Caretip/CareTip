import type { DeployUpdateNotice } from "./updateCoordinator";

export type DeployUpdateNoticeAction = "refresh" | "retry";

export type DeployUpdateNoticeCopy = {
  /** i18n key of the toast text. */
  message: string;
  /** Button shown with the notice; `null` while there is nothing the user can do. */
  action: DeployUpdateNoticeAction | null;
  /** Spinner toast (preparing / reloading): no fake percentage. */
  loading: boolean;
};

const ACTION_LABEL: Record<DeployUpdateNoticeAction, string> = {
  refresh: "shell.deployUpdate.refreshNow",
  retry: "shell.deployUpdate.retry",
};

export function deployUpdateActionLabel(action: DeployUpdateNoticeAction): string {
  return ACTION_LABEL[action];
}

/** Notice state → copy. The button only exists when it can act right away. */
export function deployUpdateNoticeCopy(notice: DeployUpdateNotice): DeployUpdateNoticeCopy | null {
  switch (notice.kind) {
    case "preparing":
      return {
        message: notice.step === "installing" ? "shell.deployUpdate.preparing" : "shell.deployUpdate.detected",
        action: null,
        loading: true,
      };
    case "ready":
      return { message: "shell.deployUpdate.ready", action: "refresh", loading: false };
    case "busy":
      return { message: "shell.deployUpdate.busy", action: null, loading: false };
    case "offline":
      return { message: "shell.deployUpdate.offline", action: null, loading: false };
    case "failed":
      return { message: "shell.deployUpdate.failed", action: "retry", loading: false };
    case "reloading":
      return { message: "shell.deployUpdate.refreshing", action: null, loading: true };
    default:
      return null;
  }
}
