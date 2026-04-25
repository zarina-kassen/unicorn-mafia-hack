import type { NormalizedLandmark } from '../pose/mediapipe'

export interface GuidanceResponse {
  recommended_template_id: string
  confidence: number
  guidance: string
  person_visible: boolean
  pose_aligned: boolean
  suggest_different: boolean
  reason: string
}

export interface PoseContextPayload {
  landmarks: NormalizedLandmark[]
  candidate_template_id: string
  local_confidence: number
  image_wh: [number, number]
  snapshot_b64?: string | null
}

export interface GuidanceClient {
  submit: (ctx: PoseContextPayload, token: string | null) => void
  subscribe: (cb: (r: GuidanceResponse) => void) => () => void
  stop: () => void
}

/**
 * Throttled client for the backend guidance agent.
 *
 * - Sends at most one request every `intervalMs`.
 * - Cancels any in-flight request when a newer one is submitted, so stale
 *   guidance never overwrites fresh guidance.
 * - Never throws at the caller: network errors are swallowed and subscribers
 *   simply stop receiving updates until the next successful response.
 */
export function createGuidanceClient(
  baseUrl: string,
  intervalMs = 1500,
  timeoutMs = 3000,
): GuidanceClient {
  let lastSend = 0
  let pending: { ctx: PoseContextPayload; token: string | null } | null = null
  let inflight: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  const listeners = new Set<(r: GuidanceResponse) => void>()

  const flush = async () => {
    if (stopped) return
    if (!pending) return
    const { ctx: payload, token } = pending
    pending = null
    lastSend = Date.now()
    inflight?.abort()
    const controller = new AbortController()
    inflight = controller
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
      const res = await fetch(`${baseUrl}/api/guidance`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!res.ok) return
      const data = (await res.json()) as GuidanceResponse
      for (const cb of listeners) cb(data)
    } catch {
      // network / abort / parsing failure — fall back to local guidance.
    } finally {
      clearTimeout(timeoutId)
      if (inflight === controller) inflight = null
    }
  }

  const schedule = () => {
    if (timer || stopped) return
    const wait = Math.max(0, intervalMs - (Date.now() - lastSend))
    timer = setTimeout(() => {
      timer = null
      void flush()
      if (pending) schedule()
    }, wait)
  }

  return {
    submit(ctx, token) {
      if (stopped) return
      pending = { ctx, token }
      schedule()
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      inflight?.abort()
      listeners.clear()
    },
  }
}
