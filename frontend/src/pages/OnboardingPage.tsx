import { useOnboarding } from '@/hooks/useOnboarding'
import { OnboardingScreen } from '@/screens/OnboardingScreen'
import { Navigate } from '@tanstack/react-router'

export function OnboardingPage() {
  const onboarding = useOnboarding()
  const { isLoaded, isSignedIn } = onboarding

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

  if (onboarding.done) {
    return <Navigate to="/camera" replace />
  }

  return (
    <OnboardingScreen
      files={onboarding.files}
      setFiles={onboarding.setFiles}
      allowLearning={onboarding.allowLearning}
      setAllowLearning={onboarding.setAllowLearning}
      skip={onboarding.skip}
      mutation={onboarding.mutation}
    />
  )
}
