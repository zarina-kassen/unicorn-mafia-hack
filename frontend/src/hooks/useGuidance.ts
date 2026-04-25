import { useAuth } from '@clerk/react'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { GuidanceClient } from '../api/guidance'
import type { PoseContextPayload } from '../api/types'

const THROTTLE_MS = 1500

export function useGuidance() {
  const { getToken } = useAuth()
  const client = useRef(new GuidanceClient(getToken))
  const pending = useRef<PoseContextPayload | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { mutate, data } = useMutation({
    mutationFn: (ctx: PoseContextPayload) => client.current.postGuidance(ctx),
  })

  const submit = useCallback(
    (ctx: PoseContextPayload) => {
      pending.current = ctx
      if (timer.current) return
      timer.current = setTimeout(() => {
        timer.current = null
        if (pending.current) {
          mutate(pending.current)
          pending.current = null
        }
      }, THROTTLE_MS)
    },
    [mutate],
  )

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return { submit, guidance: data ?? null }
}
