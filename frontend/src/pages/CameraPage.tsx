import { useOnboarding } from '@/hooks/useOnboarding'
import { CameraScreen } from '@/screens/CameraScreen'
import { Navigate } from '@tanstack/react-router'

export function CameraPage() {
  const { isLoaded, isSignedIn, done: onboardingDone } = useOnboarding()

  if (!isLoaded) {
    return (
      <div className="flex min-h-dvh w-full items-center justify-center bg-cam-surface text-cam-ink-muted">
        Loading…
      </div>
    )
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace />
  }

  if (!onboardingDone) {
    return <Navigate to="/" replace />
  }

  return <CameraScreen />
}
