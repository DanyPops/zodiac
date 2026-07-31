import { Component, type ErrorInfo, type ReactNode } from "react";

interface SurfaceBoundaryProps {
  name: string;
  children: ReactNode;
  onError?: (error: Error) => void;
}

interface SurfaceBoundaryState {
  error?: Error;
}

export class SurfaceBoundary extends Component<SurfaceBoundaryProps, SurfaceBoundaryState> {
  state: SurfaceBoundaryState = {};

  static getDerivedStateFromError(error: Error): SurfaceBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError?.(error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="surface-error" role="alert">
          <strong>{this.props.name} failed</strong>
          <span>{this.state.error.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}
