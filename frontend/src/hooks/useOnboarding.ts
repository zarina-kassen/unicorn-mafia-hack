import { useState } from 'react'
import { useAuth } from '@clerk/react'
import { useMutation } from '@tanstack/react-query'
import { OnboardingClient } from '../api/onboarding'

const STORAGE_KEY = 'frame-mog-onboarding-gallery-v1'

export function useOnboarding() {
  const { getToken } = useAuth()
  const client = new OnboardingClient(getToken)

  const [done, setDone] = useState(() =>
    typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === 'done',
  )
  const [files, setFiles] = useState<File[]>([])
  const [allowLearning, setAllowLearning] = useState(true)

  const finish = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, 'done')
    setDone(true)
  }

  const mutation = useMutation({
    mutationFn: () => client.uploadImages(files, allowLearning),
    onSuccess: (result) => {
      if (result.ok) finish()
    },
  })

  return { done, files, setFiles, allowLearning, setAllowLearning, skip: finish, mutation }
}
