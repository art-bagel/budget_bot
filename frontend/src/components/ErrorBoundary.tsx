import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="status-screen">
          <h1>Что-то пошло не так</h1>
          <p>{this.state.error.message}</p>
          <button
            className="btn btn--primary"
            style={{ marginTop: 16 }}
            onClick={() => this.setState({ error: null })}
          >
            Попробовать снова
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
