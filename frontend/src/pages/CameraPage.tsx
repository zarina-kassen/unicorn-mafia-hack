import { useOnboarding } from '@/hooks/useOnboarding'
import { CameraScreen } from '@/screens/CameraScreen'
import { Navigate } from '@tanstack/react-router'

export function CameraPage() {
  const { done: onboardingDone } = useOnboarding()

  if (!onboardingDone) {
    return <Navigate to="/" replace />
  }

  return <CameraScreen />
}
