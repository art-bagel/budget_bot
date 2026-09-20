import { Component, Fragment } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

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
