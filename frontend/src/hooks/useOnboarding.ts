import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '@clerk/react'
import { useMutation } from '@tanstack/react-query'
import { OnboardingClient } from '../api/onboarding'

const LEGACY_STORAGE_KEY = 'frame-mog-onboarding-gallery-v1'

function onboardingStorageKey(userId: string | null | undefined): string | null {
  if (!userId) return null
  return `frame-mog-onboarding-gallery-v1-${userId}`
}

function readOnboardingDone(userId: string | null | undefined): boolean {
  if (typeof window === 'undefined') return false
  const key = onboardingStorageKey(userId)
  if (!key) return false
  if (window.localStorage.getItem(key) === 'done') return true
  if (window.localStorage.getItem(LEGACY_STORAGE_KEY) === 'done') {
    window.localStorage.setItem(key, 'done')
    return true
  }
  return false
}

export function useOnboarding() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth()
  const client = new OnboardingClient(getToken)

  const [completedEpoch, setCompletedEpoch] = useState(0)
  const [files, setFiles] = useState<File[]>([])
  const [allowLearning, setAllowLearning] = useState(true)

  /* eslint-disable react-hooks/exhaustive-deps -- `completedEpoch` intentionally invalidates cache after `finish()` */
  const done = useMemo(() => readOnboardingDone(userId), [userId, completedEpoch])
  /* eslint-enable react-hooks/exhaustive-deps */

  const finish = useCallback(() => {
    const key = onboardingStorageKey(userId)
    if (typeof window !== 'undefined' && key) {
      window.localStorage.setItem(key, 'done')
    }
    setCompletedEpoch((n) => n + 1)
  }, [userId])

  const mutation = useMutation({
    mutationFn: () => client.uploadImages(files, allowLearning),
    onSuccess: (result) => {
      if (result.ok) finish()
    },
  })

  return {
    isLoaded,
    isSignedIn,
    userId,
    done,
    files,
    setFiles,
    allowLearning,
    setAllowLearning,
    skip: finish,
    mutation,
  }
}
