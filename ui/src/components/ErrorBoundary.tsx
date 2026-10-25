import { Component, type ReactNode } from "react";

/** A failed route chunk or an unexpected render error shows a recoverable message instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-xl space-y-3 p-10">
        <h1 className="text-h3 font-semibold">This view failed to load.</h1>
        <p className="text-text-2">Nothing was changed. Reload to try again; the console keeps no state you could lose.</p>
        <p className="font-mono text-meta text-text-3">{this.state.error.message}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
