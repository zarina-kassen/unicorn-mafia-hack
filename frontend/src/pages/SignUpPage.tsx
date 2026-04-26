import { SignUp, useAuth } from '@clerk/react'
import { Navigate } from '@tanstack/react-router'

export function SignUpPage() {
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
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/"
      />
    </div>
  )
}
