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
  slot_index: number
  title: string
  instruction: string
  image_url: string
  pose_template_id: string
  replaceable: boolean
  tier: 'fast' | 'hq'
  model: string
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

export interface PoseVariantEvent {
  type: 'snapshot' | 'image_ready' | 'job_done'
  job: PoseVariantJob
  result?: PoseVariantResult
}

export interface PoseMaskResponse {
  mask_url: string
  width: number
  height: number
  source: string
}

type GetToken = () => Promise<string | null>

async function withAuthHeaders(getToken?: GetToken): Promise<Headers> {
  const headers = new Headers()
  if (!getToken) return headers
  const token = await getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return headers
}

export async function createPoseVariantJob(
  referenceImage: Blob,
  baseUrl = '',
): Promise<PoseVariantJob> {
  const form = new FormData()
  form.append('reference_image', referenceImage, 'camera-reference.jpg')
  const res = await fetch(`${baseUrl}/api/pose-variants`, {
    method: 'POST',
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
): Promise<PoseVariantJob> {
  const res = await fetch(`${baseUrl}/api/pose-variants/${jobId}`)
  if (!res.ok) {
    throw new Error(`Pose generation status failed (${res.status})`)
  }
  return (await res.json()) as PoseVariantJob
}

export function subscribePoseVariantJob(
  jobId: string,
  onEvent: (event: PoseVariantEvent) => void,
  onError: (error: Event) => void,
  baseUrl = '',
): () => void {
  const stream = new EventSource(`${baseUrl}/api/pose-variants/${jobId}/events`)
  let debounce: ReturnType<typeof setTimeout> | null = null
  /** True after React cleanup calls `close()` — must not treat as a failure. */
  let closedIntentionally = false

  const clearDebounce = () => {
    if (debounce !== null) {
      clearTimeout(debounce)
      debounce = null
    }
  }

  stream.onopen = () => {
    if (closedIntentionally) return
    clearDebounce()
  }

  stream.onmessage = (message) => {
    try {
      const parsed = JSON.parse(message.data) as PoseVariantEvent
      onEvent(parsed)
    } catch {
      // Ignore malformed events.
    }
  }

  // Browsers fire `error` while reconnecting; `close()` also fires `error` with
  // CLOSED state. Only surface failure when the socket dies unexpectedly.
  stream.onerror = () => {
    if (closedIntentionally) return
    clearDebounce()
    debounce = setTimeout(() => {
      debounce = null
      if (closedIntentionally) return
      if (stream.readyState === EventSource.CLOSED) {
        onError(new Event('eventsource-closed'))
      }
    }, 2500)
  }

  return () => {
    closedIntentionally = true
    clearDebounce()
    stream.close()
  }
}

export async function extractPoseMask(
  imageUrl: string,
  baseUrl = '',
): Promise<PoseMaskResponse> {
  const res = await fetch(`${baseUrl}/api/pose-mask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl }),
  })
  if (!res.ok) {
    let detail = `${res.status}`
    try {
      const payload = (await res.json()) as { detail?: string }
      if (typeof payload.detail === 'string' && payload.detail) detail = payload.detail
    } catch {
      // keep status-only fallback
    }
    throw new Error(`pose mask extraction failed: ${detail}`)
  }
  const data = (await res.json()) as PoseMaskResponse
  if (!data.mask_url || !Number.isFinite(data.width) || !Number.isFinite(data.height)) {
    throw new Error('pose mask extraction returned invalid payload')
  }
  return data
}

export type OnboardingGalleryUploadResult =
  | { ok: true }
  | { ok: false; message: string }

export async function uploadOnboardingGalleryImages(
  files: File[],
  baseUrl = '',
  getToken?: GetToken,
  options?: { allowCameraRoll?: boolean },
): Promise<OnboardingGalleryUploadResult> {
  const form = new FormData()
  form.append('allow_camera_roll', options?.allowCameraRoll === false ? 'false' : 'true')
  for (const file of files.slice(0, 5)) {
    form.append('images', file, file.name || 'gallery.jpg')
  }
  const headers = await withAuthHeaders(getToken)
  const res = await fetch(`${baseUrl}/api/memory/onboarding/images`, {
    method: 'POST',
    headers,
    body: form,
  })
  if (!res.ok) {
    let message = `Upload failed (${res.status}).`
    try {
      const payload = (await res.json()) as { detail?: string }
      if (typeof payload.detail === 'string' && payload.detail.trim()) {
        message = payload.detail.trim()
      }
    } catch {
      // keep generic message
    }
    if (res.status === 401) {
      message = 'Sign in is required to save taste preferences.'
    }
    return { ok: false, message }
  }
  const data = (await res.json()) as { ok?: boolean }
  if (data.ok === true) {
    return { ok: true }
  }
  return {
    ok: false,
    message:
      'The server could not learn from these photos right now (memory service off, missing API keys, or tags could not be read). You can skip and try again later.',
  }
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
