import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
} from '@clerk/react'

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
import './App.css'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''

function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`
}

function App() {
  const { getToken } = useAuth()
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

  const clientRef = useRef<ReturnType<typeof createGuidanceClient> | null>(null)
  useEffect(() => {
    const client = createGuidanceClient(BACKEND_URL)
    clientRef.current = client
    const unsubscribe = client.subscribe(setGuidance)
    return () => {
      unsubscribe()
      client.stop()
      clientRef.current = null
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
    getToken().then((token) => {
      clientRef.current?.submit(payload, token)
    })
  }, [liveLandmarks, localMatch, paused, getToken])

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
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>frame-mog</h1>
          <p className="subtitle">Live pose outline camera</p>
        </div>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </header>

      <Show
        when="signed-in"
        fallback={
          <div className="auth-gate">
            <h2>Welcome to frame-mog</h2>
            <p>Sign in to access the live pose outline camera.</p>
            <div className="auth-buttons">
              <SignInButton mode="modal">
                <button type="button">Sign in</button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button type="button" className="secondary">Sign up</button>
              </SignUpButton>
            </div>
          </div>
        }
      >

      <main className="stage">
        <div className="preview">
          <video ref={videoRef} className="preview-video" playsInline muted />
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
            <div className="preview-cover">
              {cameraState.status === 'idle' && (
                <>
                  <p>We'll ask for camera access to show a live pose outline.</p>
                  <button type="button" onClick={() => void requestCamera()}>
                    Enable camera
                  </button>
                </>
              )}
              {cameraState.status === 'requesting' && <p>Requesting camera…</p>}
              {cameraState.status === 'denied' && (
                <>
                  <p className="error">{cameraState.message}</p>
                  <button type="button" onClick={() => void requestCamera()}>
                    Retry
                  </button>
                </>
              )}
              {cameraState.status === 'unavailable' && (
                <p className="error">{cameraState.message}</p>
              )}
              {cameraState.status === 'error' && (
                <>
                  <p className="error">Camera error: {cameraState.message}</p>
                  <button type="button" onClick={() => void requestCamera()}>
                    Retry
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <aside className="hud" aria-live="polite">
          <div className="hud-row">
            <span className="hud-label">Pose</span>
            <span className="hud-value">{targetTemplate.name}</span>
          </div>
          <div className="hud-row">
            <span className="hud-label">Confidence</span>
            <span className="hud-value">{formatConfidence(displayedConfidence)}</span>
          </div>
          <p className="hud-guidance">{displayedGuidance}</p>

          <div className="hud-controls">
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              disabled={cameraState.status !== 'ready'}
            >
              {paused ? 'Resume live analysis' : 'Pause live analysis'}
            </button>
          </div>

          {landmarkerError && (
            <p className="error small">Pose tracker: {landmarkerError}</p>
          )}
        </aside>
      </main>

      </Show>
    </div>
  )
}

export default App
