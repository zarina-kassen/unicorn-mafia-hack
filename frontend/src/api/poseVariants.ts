import { type GetToken } from './base'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''

export interface PoseOutlinePoint {
  x: number
  y: number
}

export interface PoseOutlineResponse {
  polygon: PoseOutlinePoint[]
  width: number
  height: number
  source: string
  model: string
}

/** Full variant as returned in SSE `pose` events (matches backend `PoseVariantResult`). */
export interface PoseVariantResult {
  id: string
  slot_index: number
  title: string
  instruction: string
  image_url: string
  target_id: string
  target_landmarks: unknown[]
  replaceable: boolean
  tier: string
  model: string
}

export interface PoseStreamPosePayload {
  pose: PoseVariantResult
  outline: PoseOutlineResponse
}

export interface PoseStreamPhasePayload {
  step: string
  count?: number
}

export interface PoseStreamHandlers {
  onPhase?: (payload: PoseStreamPhasePayload) => void
  onTargetCount?: (count: number) => void
  onPose?: (payload: PoseStreamPosePayload) => void
  onPoseError?: (payload: { slot_index: number; message: string }) => void
  onError?: (payload: { message: string }) => void
  onDone?: (payload: { count: number }) => void
}

function parseCompleteSseMessages(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = []
  const sep = '\n\n'
  let rest = buffer
  let idx = rest.indexOf(sep)
  while (idx !== -1) {
    const block = rest.slice(0, idx)
    rest = rest.slice(idx + sep.length)
    let eventName = 'message'
    let dataLine: string | undefined
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) eventName = line.slice(7).trim()
      else if (line.startsWith('data: ')) dataLine = line.slice(6).trimEnd()
    }
    if (dataLine !== undefined) events.push({ event: eventName, data: dataLine })
    idx = rest.indexOf(sep)
  }
  return { events, rest }
}

function dispatchSseEvent(event: string, data: string, handlers: PoseStreamHandlers): void {
  const payload = JSON.parse(data) as unknown
  switch (event) {
    case 'phase':
      handlers.onPhase?.(payload as PoseStreamPhasePayload)
      break
    case 'target_count':
      handlers.onTargetCount?.((payload as { count: number }).count)
      break
    case 'pose':
      handlers.onPose?.(payload as PoseStreamPosePayload)
      break
    case 'pose_error':
      handlers.onPoseError?.(payload as { slot_index: number; message: string })
      break
    case 'error':
      handlers.onError?.(payload as { message: string })
      break
    case 'done':
      handlers.onDone?.(payload as { count: number })
      break
    default:
      break
  }
}

/** Events that should paint before the next SSE message (avoids one paint when many arrive in one chunk). */
const SSE_EVENTS_NEEDING_FRAME = new Set([
  'phase',
  'target_count',
  'pose',
  'pose_error',
])

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      queueMicrotask(resolve)
    }
  })
}

async function dispatchSseEventForStream(
  event: string,
  data: string,
  handlers: PoseStreamHandlers,
): Promise<void> {
  dispatchSseEvent(event, data, handlers)
  if (SSE_EVENTS_NEEDING_FRAME.has(event)) {
    await yieldToBrowser()
  }
}

export async function streamPoseVariants(
  referenceImage: Blob,
  options: {
    getToken?: GetToken
    signal?: AbortSignal
    handlers: PoseStreamHandlers
  },
): Promise<void> {
  const url = `${BACKEND_URL}/api/pose-variants`
  const token = options.getToken ? await options.getToken() : null
  const headers: HeadersInit = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const form = new FormData()
  form.append('reference_image', referenceImage, 'camera-reference.jpg')

  const res = await fetch(url, {
    method: 'POST',
    body: form,
    headers: {
      ...headers,
      Accept: 'text/event-stream',
    },
    signal: options.signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Pose generation failed: ${res.status} ${text}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const { events, rest } = parseCompleteSseMessages(buf)
    buf = rest
    for (const { event, data } of events) {
      await dispatchSseEventForStream(event, data, options.handlers)
    }
  }
  buf += decoder.decode()
  if (buf.trim()) {
    const tail = buf.endsWith('\n\n') ? buf : `${buf}\n\n`
    const { events } = parseCompleteSseMessages(tail)
    for (const { event, data } of events) {
      await dispatchSseEventForStream(event, data, options.handlers)
    }
  }
}

export class PoseVariantsClient {
  private readonly getToken?: GetToken

  constructor(getToken?: GetToken) {
    this.getToken = getToken
  }

  stream(referenceImage: Blob, handlers: PoseStreamHandlers, signal?: AbortSignal): Promise<void> {
    return streamPoseVariants(referenceImage, {
      getToken: this.getToken,
      signal,
      handlers,
    })
  }
}
