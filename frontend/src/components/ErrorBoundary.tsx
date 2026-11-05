import { Component, Fragment } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { clearStart } from '../startCache';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  // Счётчик ремонтов. Раньше поддерево пересоздавал внешний key из App, и
  // «Попробовать снова» работало за счёт него. Теперь ремонт нужен свой,
  // иначе кнопка вернула бы то же самое упавшее дерево с его состоянием
  // и оно упало бы снова на первом же рендере.
  resetCount: number;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetCount: 0 };

  static getDerivedStateFromError(error: Error): Pick<State, 'error'> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
    // A start snapshot of an outdated shape may be what broke the render:
    // wipe it, so "try again" and the next start load from the server.
    clearStart();
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
            onClick={() => this.setState((prev) => ({ error: null, resetCount: prev.resetCount + 1 }))}
          >
            Попробовать снова
          </button>
        </div>
      );
    }

    return <Fragment key={this.state.resetCount}>{this.props.children}</Fragment>;
  }
}
