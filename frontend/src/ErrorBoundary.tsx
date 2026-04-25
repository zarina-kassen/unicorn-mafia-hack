import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string | null
  retryKey: number
}

/**
 * Catches render/lifecycle errors so one bad update does not blank the whole
 * tree without context (common while iterating on camera / gallery UI).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = {
    hasError: false,
    message: null,
    retryKey: 0,
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, message: error.message }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[frame-mog] UI error', error, info.componentStack)
  }

  private handleRetry = (): void => {
    this.setState((s) => ({
      hasError: false,
      message: null,
      retryKey: s.retryKey + 1,
    }))
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100dvh',
            padding: 24,
            color: '#f9fafb',
            background: '#0a0a0c',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h1 style={{ fontSize: '1.1rem', margin: '0 0 12px' }}>Something went wrong</h1>
          <p style={{ opacity: 0.85, margin: '0 0 20px', lineHeight: 1.45 }}>
            {this.state.message ?? 'Unexpected error'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              padding: '10px 18px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.35)',
              background: 'rgba(255,255,255,0.08)',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      )
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>
  }
}
