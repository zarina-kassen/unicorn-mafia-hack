import { SignIn, useAuth } from '@clerk/react'
import { Navigate } from '@tanstack/react-router'

export function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) {
    return (
      <div className="flex min-h-dvh w-full items-center justify-center bg-cam-surface text-cam-ink-muted">
        Loading…
      </div>
    )
  }

  if (isSignedIn) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-cam-surface p-4">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/"
      />
    </div>
  )
}
