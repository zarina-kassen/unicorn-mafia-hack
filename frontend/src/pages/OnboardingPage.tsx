import { useOnboarding } from '@/hooks/useOnboarding'
import { OnboardingScreen } from '@/screens/OnboardingScreen'
import { Navigate } from '@tanstack/react-router'

export function OnboardingPage() {
  const onboarding = useOnboarding()

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
