import { useAuth } from '@clerk/react'
import { useMutation } from '@tanstack/react-query'
import { useRef } from 'react'
import { PoseVariantClient } from '../api/poseVariants'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''

export function usePoseVariants() {
  const { getToken } = useAuth()
  const client = useRef(new PoseVariantClient(getToken, BACKEND_URL))

  const createJob = useMutation({
    mutationFn: (referenceImage: Blob) => client.current.createPoseVariantJob(referenceImage),
  })

  return { createJob }
}
