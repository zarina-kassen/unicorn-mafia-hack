import { useEffect, useRef, useState } from 'react'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'

import { createPoseLandmarker, type NormalizedLandmark } from './mediapipe'

export interface UsePoseLandmarkerResult {
  ready: boolean
  error: string | null
}

/**
 * Drives a MediaPipe PoseLandmarker at up to the browser's animation frame
 * rate. Landmarks are reported through the stable `onLandmarks` callback; the
 * callback is stored in a ref so changes don't rebuild the landmarker.
 */
export function usePoseLandmarker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onLandmarks: (landmarks: NormalizedLandmark[] | null) => void,
): UsePoseLandmarkerResult {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const callbackRef = useRef(onLandmarks)

  useEffect(() => {
    callbackRef.current = onLandmarks
  }, [onLandmarks])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let rafId = 0
    let landmarker: PoseLandmarker | null = null
    let lastVideoTime = -1

    const tick = () => {
      if (cancelled || !landmarker) return
      const video = videoRef.current
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        const now = performance.now()
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime
          try {
            const result = landmarker.detectForVideo(video, now)
            callbackRef.current(result.landmarks?.[0] ?? null)
          } catch (err) {
            // Detection can occasionally throw on the first frame if the
            // GPU delegate falls back; just report null for that frame.
            if (err instanceof Error) setError(err.message)
            callbackRef.current(null)
          }
        }
      }
      rafId = requestAnimationFrame(tick)
    }

    ;(async () => {
      try {
        landmarker = await createPoseLandmarker()
        if (cancelled) {
          landmarker.close()
          return
        }
        setReady(true)
        rafId = requestAnimationFrame(tick)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cancelled = true
      if (rafId) cancelAnimationFrame(rafId)
      landmarker?.close()
      landmarker = null
      setReady(false)
    }
  }, [enabled, videoRef])

  return { ready, error }
}
