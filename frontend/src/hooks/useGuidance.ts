import { useMutation } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import type { GuidanceResponse, PoseContextPayload } from '../backend/client'
import { useAuthFetch } from './useAuthFetch'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''
const THROTTLE_MS = 1500

/**
 * Hook that manages posting pose context to `/api/guidance` and returning
 * the latest guidance response. Requests are throttled to at most one
 * every {@link THROTTLE_MS} ms to avoid overwhelming the backend.
 */
export function useGuidance() {
  const authFetch = useAuthFetch()
  const lastSendRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<PoseContextPayload | null>(null)

  const { mutate, data: guidance } = useMutation<
    GuidanceResponse,
    Error,
    PoseContextPayload
  >({
    mutationFn: async (ctx) => {
      const res = await authFetch(`${BACKEND_URL}/api/guidance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ctx),
      })
      if (!res.ok) throw new Error(`guidance ${res.status}`)
      return res.json() as Promise<GuidanceResponse>
    },
  })

  const flush = useCallback(() => {
    const payload = pendingRef.current
    if (!payload) return
    pendingRef.current = null
    lastSendRef.current = Date.now()
    mutate(payload)
  }, [mutate])

  const submit = useCallback(
    (ctx: PoseContextPayload) => {
      pendingRef.current = ctx
      if (timerRef.current) return
      const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastSendRef.current))
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        flush()
      }, wait)
    },
    [flush],
  )

  return { submit, guidance: guidance ?? null }
}
