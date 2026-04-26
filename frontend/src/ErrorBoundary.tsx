import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

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
        <div className="flex min-h-dvh items-center justify-center bg-background p-6">
          <Card className="w-full max-w-md border-destructive/30">
            <CardHeader>
              <CardTitle>Something went wrong</CardTitle>
              <CardDescription className="text-destructive">
                {this.state.message ?? 'Unexpected error'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Try again. If the problem persists, refresh the page.
              </p>
            </CardContent>
            <CardFooter>
              <Button type="button" onClick={this.handleRetry}>
                Try again
              </Button>
            </CardFooter>
          </Card>
        </div>
      )
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>
  }
}
