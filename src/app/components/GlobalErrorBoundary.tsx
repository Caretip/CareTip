import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { captureClientException } from "../lib/sentry";
import { isChunkLoadFailure } from "../lib/chunkLoadRecovery";
import { handleChunkLoadFailure } from "../lib/deployUpdate/runtime";
import i18n from "@/i18n/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches React render/lifecycle errors and logs them with the component stack.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Error in GlobalErrorBoundary (render crash):", error);
    console.error("Component stack:", errorInfo.componentStack);
    captureClientException(error, {
      scope: "GlobalErrorBoundary",
      componentStack: errorInfo.componentStack,
    });
    if (isChunkLoadFailure(error)) {
      handleChunkLoadFailure(error);
    }
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="text-center max-w-md">
            {/* Sits above the providers: uses the shared i18n instance directly. */}
            <h1 className="text-xl font-semibold text-foreground">{i18n.t("common.errorScreen.crashTitle")}</h1>
            <p className="text-muted-foreground mt-2 text-sm">{i18n.t("common.errorScreen.crashBody")}</p>
            <button
              type="button"
              className="mt-6 inline-flex px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover text-sm font-medium"
              onClick={() => window.location.reload()}
            >
              {i18n.t("common.errorScreen.crashAction")}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
