import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Card } from '../ui/Card';
import { BackLink } from './BackLink';

interface State {
  error?: Error;
}

/** A page that throws while rendering shows an error instead of unmounting the whole app; a new `key` (another route) resets it. */
export class PageBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <Card>
        <p className="error">This page could not be shown ({this.state.error.message}).</p>
        <BackLink />
      </Card>
    );
  }
}
