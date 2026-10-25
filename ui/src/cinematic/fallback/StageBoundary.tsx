import { Component, type ReactNode } from "react";

/** Catches anything the WebGL stage throws while rendering (shader failure, context creation) and hands over to the poster. */
export class StageBoundary extends Component<{ children: ReactNode; onFail: (why: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onFail(error.message || "WebGL stage failed"); }
  render() { return this.state.failed ? null : this.props.children; }
}
