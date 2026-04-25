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
  submit: (ctx: PoseContextPayload) => void
  subscribe: (cb: (r: GuidanceResponse) => void) => () => void
  stop: () => void
}

export interface PoseVariantResult {
  id: string
  title: string
  instruction: string
  image_url: string
  pose_template_id: string
  replaceable: boolean
}

export type PoseVariantJobStatus = 'queued' | 'generating' | 'ready' | 'failed'

export interface PoseVariantJob {
  job_id: string
  status: PoseVariantJobStatus
  progress: number
  total: number
  results: PoseVariantResult[]
  error?: string | null
}

export interface MemorySeedEntryPayload {
  source_ref: string
  pose_tags: string[]
  style_tags: string[]
  composition_tags: string[]
  scene_tags: string[]
  confidence: number
}

export interface MemoryFeedbackPayload {
  event: string
  pose_template_id?: string | null
  scene_tags?: string[]
  outcome_score?: number | null
}

export interface MemoryPreferencesPayload {
  allow_camera_roll: boolean
  allow_instagram: boolean
  allow_pinterest: boolean
}

type GetToken = () => Promise<string | null>

async function withAuthHeaders(
  getToken?: GetToken,
  init?: HeadersInit,
): Promise<Headers> {
  const headers = new Headers(init)
  if (getToken) {
    const token = await getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  return headers
}

export async function createPoseVariantJob(
  referenceImage: Blob,
  baseUrl = '',
  getToken?: GetToken,
): Promise<PoseVariantJob> {
  const form = new FormData()
  form.append('reference_image', referenceImage, 'camera-reference.jpg')
  const headers = await withAuthHeaders(getToken)
  const res = await fetch(`${baseUrl}/api/pose-variants`, {
    method: 'POST',
    headers,
    body: form,
  })
  if (!res.ok) {
    throw new Error(`Pose generation failed to start (${res.status})`)
  }
  return (await res.json()) as PoseVariantJob
}

export async function getPoseVariantJob(
  jobId: string,
  baseUrl = '',
  getToken?: GetToken,
): Promise<PoseVariantJob> {
  const headers = await withAuthHeaders(getToken)
  const res = await fetch(`${baseUrl}/api/pose-variants/${jobId}`, { headers })
  if (!res.ok) {
    throw new Error(`Pose generation status failed (${res.status})`)
  }
  return (await res.json()) as PoseVariantJob
}

export async function postMemoryOnboarding(
  entries: MemorySeedEntryPayload[],
  baseUrl = '',
  getToken?: GetToken,
): Promise<boolean> {
  const headers = await withAuthHeaders(getToken, { 'content-type': 'application/json' })
  const res = await fetch(`${baseUrl}/api/memory/onboarding`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ entries }),
  })
  return res.ok
}

export async function postMemoryFeedback(
  payload: MemoryFeedbackPayload,
  baseUrl = '',
  getToken?: GetToken,
): Promise<boolean> {
  const headers = await withAuthHeaders(getToken, { 'content-type': 'application/json' })
  const res = await fetch(`${baseUrl}/api/memory/feedback`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  return res.ok
}

export async function postMemoryPreferences(
  payload: MemoryPreferencesPayload,
  baseUrl = '',
  getToken?: GetToken,
): Promise<boolean> {
  const headers = await withAuthHeaders(getToken, { 'content-type': 'application/json' })
  const res = await fetch(`${baseUrl}/api/memory/preferences`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  return res.ok
}

export async function postMemoryReset(
  hardReset: boolean,
  baseUrl = '',
  getToken?: GetToken,
): Promise<boolean> {
  const headers = await withAuthHeaders(getToken, { 'content-type': 'application/json' })
  const res = await fetch(`${baseUrl}/api/memory/reset`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ hard_reset: hardReset }),
  })
  return res.ok
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
  let pending: PoseContextPayload | null = null
  let inflight: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  const listeners = new Set<(r: GuidanceResponse) => void>()

  const flush = async () => {
    if (stopped) return
    if (!pending) return
    const payload = pending
    pending = null
    lastSend = Date.now()
    inflight?.abort()
    inflight = new AbortController()
    const timeoutId = setTimeout(() => inflight?.abort(), timeoutMs)
    try {
      const res = await fetch(`${baseUrl}/api/guidance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: inflight.signal,
      })
      if (!res.ok) return
      const data = (await res.json()) as GuidanceResponse
      for (const cb of listeners) cb(data)
    } catch {
      // network / abort / parsing failure — fall back to local guidance.
    } finally {
      clearTimeout(timeoutId)
      inflight = null
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
    submit(ctx) {
      if (stopped) return
      pending = ctx
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
