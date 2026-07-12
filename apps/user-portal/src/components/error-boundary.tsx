'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorCard } from '@/components/shared/page-header';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error boundary:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorCard
          title={this.props.fallbackTitle ?? 'Page failed to load'}
          message={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }

    return this.props.children;
  }
}
