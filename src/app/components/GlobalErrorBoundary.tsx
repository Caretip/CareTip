import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { captureClientException } from "../lib/sentry";
import { isChunkLoadFailure, recoverStaleChunkOnce } from "../lib/chunkLoadRecovery";

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
      recoverStaleChunkOnce();
    }
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="text-center max-w-md">
            <h1 className="text-xl font-semibold text-foreground">This screen hit a problem</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Refresh the page to try again. If it keeps happening, contact support with what you were doing when it broke.
            </p>
            <button
              type="button"
              className="mt-6 inline-flex px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover text-sm font-medium"
              onClick={() => window.location.reload()}
            >
              Refresh page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
