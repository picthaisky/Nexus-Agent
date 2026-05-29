import React from "react";

interface State {
  hasError: boolean;
  message?: string;
}

interface Props {
  children: React.ReactNode;
}

/**
 * Catches render-time errors in any child subtree so a single
 * widget crash does not blank out the whole dashboard.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[Nexus] render error", error, info);
  }

  private reset = () => this.setState({ hasError: false, message: undefined });

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-100">
          <div className="max-w-md rounded-lg border border-red-500/30 bg-slate-900 p-6 text-center shadow-xl">
            <h1 className="mb-2 text-xl font-semibold text-red-400">
              Something went wrong
            </h1>
            <p className="mb-4 text-sm text-slate-400">
              {this.state.message ?? "An unexpected error occurred."}
            </p>
            <button
              type="button"
              onClick={this.reset}
              className="rounded bg-cyan-500/20 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/30"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
