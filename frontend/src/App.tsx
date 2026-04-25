import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useCamera } from './camera/useCamera'
import type { NormalizedLandmark } from './pose/mediapipe'
import { usePoseLandmarker } from './pose/usePoseLandmarker'
import { TEMPLATES, getTemplate, type PoseTemplate } from './pose/templates'
import { matchTemplate } from './pose/matcher'
import { PoseOverlay } from './overlay/PoseOverlay'
import {
  createGuidanceClient,
  type GuidanceResponse,
  type PoseContextPayload,
} from './backend/client'
import { Button } from '@/components/ui/button'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''

function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { state: cameraState, request: requestCamera } = useCamera(videoRef)
  const [paused, setPaused] = useState(false)
  const [liveLandmarks, setLiveLandmarks] = useState<NormalizedLandmark[] | null>(null)
  const [localMatch, setLocalMatch] = useState<{
    template: PoseTemplate
    score: number
    personVisible: boolean
  }>(() => ({ template: TEMPLATES[0], score: 0, personVisible: false }))
  const [guidance, setGuidance] = useState<GuidanceResponse | null>(null)

  const landmarkerEnabled = cameraState.status === 'ready' && !paused

  const handleLandmarks = useCallback((lm: NormalizedLandmark[] | null) => {
    setLiveLandmarks(lm)
    if (!lm) {
      setLocalMatch((prev) => ({ ...prev, score: 0, personVisible: false }))
      return
    }
    const result = matchTemplate(lm, TEMPLATES)
    setLocalMatch({
      template: getTemplate(result.templateId),
      score: result.score,
      personVisible: result.personVisible,
    })
  }, [])

  const { error: landmarkerError } = usePoseLandmarker(
    videoRef,
    landmarkerEnabled,
    handleLandmarks,
  )

  const clientRef = useRef(createGuidanceClient(BACKEND_URL))
  useEffect(() => {
    const client = clientRef.current
    const unsubscribe = client.subscribe(setGuidance)
    return () => {
      unsubscribe()
      client.stop()
    }
  }, [])

  useEffect(() => {
    if (!liveLandmarks || paused) return
    const video = videoRef.current
    const wh: [number, number] = video
      ? [video.videoWidth || 0, video.videoHeight || 0]
      : [0, 0]
    const payload: PoseContextPayload = {
      landmarks: liveLandmarks.map((lm) => ({
        x: lm.x,
        y: lm.y,
        z: lm.z ?? 0,
        visibility: lm.visibility ?? 0,
      })),
      candidate_template_id: localMatch.template.id,
      local_confidence: localMatch.score,
      image_wh: wh,
    }
    clientRef.current.submit(payload)
  }, [liveLandmarks, localMatch, paused])

  // If the agent suggests a different template with high confidence, prefer it.
  const targetTemplate = useMemo(() => {
    if (
      guidance?.suggest_different &&
      guidance.confidence >= 0.6 &&
      guidance.recommended_template_id !== localMatch.template.id
    ) {
      return getTemplate(guidance.recommended_template_id)
    }
    return localMatch.template
  }, [guidance, localMatch.template])

  const displayedConfidence = guidance?.confidence ?? localMatch.score
  const displayedGuidance = !localMatch.personVisible
    ? 'Step fully into frame — we need to see your shoulders and hips.'
    : guidance?.guidance ?? targetTemplate.guidance

  return (
    <div className="mx-auto flex min-h-screen max-w-[1280px] flex-col gap-4 p-6 text-slate-200">
      <header className="flex items-baseline justify-between border-b border-slate-400/20 pb-2">
        <h1 className="m-0 text-[1.75rem] tracking-tight">frame-mog</h1>
        <p className="m-0 text-muted-foreground">Live pose outline camera</p>
      </header>

      <main className="grid flex-1 items-start gap-5 grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] max-md:grid-cols-1">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-[#020617] shadow-[0_20px_60px_rgba(15,23,42,0.5)]">
          <video
            ref={videoRef}
            className="h-full w-full -scale-x-100 bg-[#020617] object-cover"
            playsInline
            muted
          />
          {cameraState.status === 'ready' && (
            <PoseOverlay
              videoRef={videoRef}
              liveLandmarks={liveLandmarks}
              targetTemplate={targetTemplate}
              mirrored
              paused={paused}
            />
          )}
          {cameraState.status !== 'ready' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[rgba(2,6,23,0.85)] p-6 text-center">
              {cameraState.status === 'idle' && (
                <>
                  <p>We'll ask for camera access to show a live pose outline.</p>
                  <Button onClick={() => void requestCamera()}>
                    Enable camera
                  </Button>
                </>
              )}
              {cameraState.status === 'requesting' && <p>Requesting camera…</p>}
              {cameraState.status === 'denied' && (
                <>
                  <p className="text-red-300">{cameraState.message}</p>
                  <Button onClick={() => void requestCamera()}>
                    Retry
                  </Button>
                </>
              )}
              {cameraState.status === 'unavailable' && (
                <p className="text-red-300">{cameraState.message}</p>
              )}
              {cameraState.status === 'error' && (
                <>
                  <p className="text-red-300">Camera error: {cameraState.message}</p>
                  <Button onClick={() => void requestCamera()}>
                    Retry
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        <aside
          className="flex flex-col gap-3.5 rounded-2xl border border-slate-400/20 bg-[rgba(15,23,42,0.7)] p-5 backdrop-blur-sm"
          aria-live="polite"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Pose
            </span>
            <span className="text-lg font-semibold">{targetTemplate.name}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Confidence
            </span>
            <span className="text-lg font-semibold">
              {formatConfidence(displayedConfidence)}
            </span>
          </div>
          <p className="m-0 text-base leading-relaxed">{displayedGuidance}</p>

          <div>
            <Button
              variant="secondary"
              onClick={() => setPaused((p) => !p)}
              disabled={cameraState.status !== 'ready'}
            >
              {paused ? 'Resume live analysis' : 'Pause live analysis'}
            </Button>
          </div>

          {landmarkerError && (
            <p className="text-sm text-red-300">
              Pose tracker: {landmarkerError}
            </p>
          )}
        </aside>
      </main>
    </div>
  )
}

export default App
