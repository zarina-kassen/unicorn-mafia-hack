import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import type { GuidanceResponse, PoseContextPayload } from '../backend/client'
import { useAuthFetch } from './useAuthFetch'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''
const THROTTLE_MS = 1500
const TIMEOUT_MS = 3000

/**
 * Hook that manages posting pose context to `/api/guidance` and returning
 * the latest guidance response.
 *
 * - Requests are throttled to at most one every {@link THROTTLE_MS}.
 * - In-flight requests are aborted when a newer one fires.
 * - Each request has a {@link TIMEOUT_MS} deadline.
 * - Timers are cleaned up on unmount.
 */
export function useGuidance() {
  const authFetch = useAuthFetch()
  const lastSendRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<PoseContextPayload | null>(null)
  const inflightRef = useRef<AbortController | null>(null)

  const { mutate, data: guidance } = useMutation<
    GuidanceResponse,
    Error,
    PoseContextPayload
  >({
    mutationFn: async (ctx) => {
      inflightRef.current?.abort()
      const controller = new AbortController()
      inflightRef.current = controller
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const res = await authFetch(`${BACKEND_URL}/api/guidance`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(ctx),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`guidance ${res.status}`)
        return res.json() as Promise<GuidanceResponse>
      } finally {
        clearTimeout(timeoutId)
        if (inflightRef.current === controller) inflightRef.current = null
      }
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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      inflightRef.current?.abort()
    }
  }, [])

  return { submit, guidance: guidance ?? null }
}
