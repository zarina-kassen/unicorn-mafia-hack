import { useAuth } from '@clerk/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { extractPoseMask } from '../api/poseMask'
import {
  PoseVariantsClient,
  type PoseOutlineResponse,
  type PoseVariantResult,
} from '../api/poseVariants'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''

export interface GalleryPose {
  id: string
  title: string
  imageSrc: string
  instruction: string
}

function assetUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  return `${BACKEND_URL}${path}`
}

function toGalleryPose(r: PoseVariantResult): GalleryPose {
  return {
    id: r.id,
    title: r.title,
    imageSrc: assetUrl(r.image_url),
    instruction: r.instruction,
  }
}

/** Smaller reference = faster upload + upstream image APIs; quality tradeoff is OK for pose gen. */
const REFERENCE_CAPTURE_MAX_EDGE = 720
const REFERENCE_JPEG_QUALITY = 0.78

function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) {
    return Promise.reject(new Error('Camera frame is not ready yet.'))
  }
  let w = video.videoWidth
  let h = video.videoHeight
  const longest = Math.max(w, h)
  if (longest > REFERENCE_CAPTURE_MAX_EDGE) {
    const s = REFERENCE_CAPTURE_MAX_EDGE / longest
    w = Math.max(1, Math.round(w * s))
    h = Math.max(1, Math.round(h * s))
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Could not capture camera frame.'))
  ctx.translate(canvas.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode camera frame.'))),
      'image/jpeg',
      REFERENCE_JPEG_QUALITY,
    )
  })
}

export function usePoseVariants() {
  const { getToken } = useAuth()
  const client = useMemo(() => new PoseVariantsClient(getToken), [getToken])
  const abortRef = useRef<AbortController | null>(null)

  const [variants, setVariants] = useState<PoseVariantResult[]>([])
  const [outlines, setOutlines] = useState<Record<string, PoseOutlineResponse>>({})
  /** Branch-5-style mask guide URLs keyed by pose id (preferred over vision JSON outline). */
  const [maskUrls, setMaskUrls] = useState<Record<string, string>>({})
  const maskFetchStartedRef = useRef<Set<string>>(new Set())
  const [expectedCount, setExpectedCount] = useState(0)
  /** Server SSE phase: planning (LLM targets) vs generating (parallel images). */
  const [streamPhase, setStreamPhase] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [isError, setIsError] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const poses = useMemo(
    () =>
      [...variants]
        .sort((a, b) => a.slot_index - b.slot_index)
        .map(toGalleryPose),
    [variants],
  )

  const mutate = useCallback(
    async (videoEl: HTMLVideoElement) => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setIsPending(true)
      setIsSuccess(false)
      setIsError(false)
      setError(null)
      setVariants([])
      setOutlines({})
      setMaskUrls({})
      maskFetchStartedRef.current = new Set()
      setExpectedCount(0)
      setStreamPhase(null)

      try {
        const frame = await captureFrame(videoEl)
        await client.stream(
          frame,
          {
            onPhase: (p) => {
              flushSync(() => setStreamPhase(p.step))
            },
            onTargetCount: (count) => {
              flushSync(() => setExpectedCount(count))
            },
            onPose: ({ pose, outline }) => {
              flushSync(() => {
                setVariants((prev) =>
                  [...prev.filter((p) => p.id !== pose.id), pose].sort(
                    (a, b) => a.slot_index - b.slot_index,
                  ),
                )
                setOutlines((prev) => ({ ...prev, [pose.id]: outline }))
              })
            },
            onPoseError: () => {
              /* per-slot failure: optional UI could aggregate */
            },
            onError: (p) => {
              setIsPending(false)
              setStreamPhase(null)
              setIsError(true)
              setError(new Error(p.message))
            },
            onDone: ({ count }) => {
              setIsPending(false)
              setStreamPhase(null)
              setIsSuccess(count > 0)
              if (count === 0) setIsError(true)
            },
          },
          ac.signal,
        )
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setIsPending(false)
        setStreamPhase(null)
        setIsError(true)
        setError(e instanceof Error ? e : new Error(String(e)))
      }
    },
    [client],
  )

  useEffect(() => {
    const tokenFn = getToken
    for (const v of variants) {
      if (maskFetchStartedRef.current.has(v.id)) continue
      maskFetchStartedRef.current.add(v.id)
      void extractPoseMask(v.image_url, tokenFn)
        .then((res) => {
          setMaskUrls((prev) => ({ ...prev, [v.id]: res.mask_url }))
        })
        .catch(() => {
          /* Outline fallback remains in `outlines` */
        })
    }
  }, [variants, getToken])

  return {
    data: poses,
    outlines,
    maskUrls,
    expectedCount,
    streamPhase,
    mutate,
    isPending,
    isSuccess,
    isError,
    error,
  }
}
