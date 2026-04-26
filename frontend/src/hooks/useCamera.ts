import { useCallback, useEffect, useRef, useState } from 'react'

export type CameraState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'ready' }
  | { status: 'denied'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }

export interface UseCameraResult {
  state: CameraState
  request: () => Promise<void>
  stop: () => void
}

/**
 * Manages camera access for the live preview. The returned `request` function
 * asks the browser for user-facing camera permission and attaches the stream
 * to the provided <video> element. It never throws — all failures are
 * surfaced through the state machine.
 */
export function useCamera(
  videoRef: React.RefObject<HTMLVideoElement | null>,
): UseCameraResult {
  const [state, setState] = useState<CameraState>({ status: 'idle' })
  const streamRef = useRef<MediaStream | null>(null)

  const stop = useCallback(() => {
    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
    }
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setState({ status: 'idle' })
  }, [videoRef])

  const request = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({
        status: 'unavailable',
        message: 'This browser does not expose a camera API. Try Chrome on desktop or Android.',
      })
      return
    }
    setState({ status: 'requesting' })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        video.muted = true
        video.playsInline = true
        await video.play().catch(() => {
          /* play() can reject if the tab is not focused; user can retry */
        })
      }
      setState({ status: 'ready' })
    } catch (err) {
      const name = (err as DOMException)?.name ?? ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setState({
          status: 'denied',
          message: 'Camera permission was blocked. Enable it in browser settings and retry.',
        })
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setState({
          status: 'unavailable',
          message: 'No compatible camera was found on this device.',
        })
      } else {
        const message = err instanceof Error ? err.message : String(err)
        setState({ status: 'error', message })
      }
    }
  }, [videoRef])

  // Always release the camera when the component using the hook unmounts.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop()
        streamRef.current = null
      }
    }
  }, [])

  return { state, request, stop }
}
