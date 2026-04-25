import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useCamera } from './camera/useCamera'
import type { NormalizedLandmark } from './pose/mediapipe'
import { usePoseLandmarker } from './pose/usePoseLandmarker'
import { matchTemplate } from './pose/matcher'
import { PoseOverlay } from './overlay/PoseOverlay'
import { GALLERY_POSES, type GalleryPose } from './pose/galleryTargets'
import {
  createPoseVariantJob,
  getPoseVariantJob,
  type PoseVariantResult,
} from './backend/client'
import './App.css'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''

type AlignmentStatus = 'finding' | 'adjusting' | 'close'
type GenerationStatus = 'idle' | 'capturing' | 'generating' | 'ready' | 'failed'

interface AlignmentState {
  status: AlignmentStatus
  score: number
}

function getAlignmentCopy(status: AlignmentStatus): string {
  if (status === 'close') return 'Close match'
  if (status === 'adjusting') return 'Adjust your pose'
  return 'Step into frame'
}

function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) {
    return Promise.reject(new Error('Camera frame is not ready yet.'))
  }

  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Could not capture camera frame.'))

  // Match the mirrored selfie preview the user sees.
  ctx.translate(canvas.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Could not encode camera frame.'))
      },
      'image/jpeg',
      0.92,
    )
  })
}

function backendAssetUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  return `${BACKEND_URL}${path}`
}

function galleryPoseFromResult(result: PoseVariantResult): GalleryPose {
  const templateSource =
    GALLERY_POSES.find((pose) => pose.id === result.pose_template_id) ??
    GALLERY_POSES.find((pose) => pose.id === result.id) ??
    GALLERY_POSES[0]

  return {
    ...templateSource,
    id: result.id,
    title: result.title,
    instruction: result.instruction,
    imageSrc: backendAssetUrl(result.image_url),
    replaceableAsset: result.replaceable,
  }
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { state: cameraState, request: requestCamera } = useCamera(videoRef)
  const [galleryPoses, setGalleryPoses] = useState<GalleryPose[]>(GALLERY_POSES)
  const [selectedPoseId, setSelectedPoseId] = useState(GALLERY_POSES[0].id)
  const [liveLandmarks, setLiveLandmarks] = useState<NormalizedLandmark[] | null>(null)
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle')
  const [generationJobId, setGenerationJobId] = useState<string | null>(null)
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 10 })
  const [generationError, setGenerationError] = useState<string | null>(null)

  const landmarkerEnabled = cameraState.status === 'ready'
  const selectedPose = useMemo(
    () => galleryPoses.find((pose) => pose.id === selectedPoseId) ?? galleryPoses[0],
    [galleryPoses, selectedPoseId],
  )

  const handleLandmarks = useCallback((lm: NormalizedLandmark[] | null) => {
    setLiveLandmarks(lm)
  }, [])

  const { error: landmarkerError } = usePoseLandmarker(
    videoRef,
    landmarkerEnabled,
    handleLandmarks,
  )

  const alignment = useMemo<AlignmentState>(() => {
    if (cameraState.status !== 'ready' || !liveLandmarks) {
      return { status: 'finding', score: 0 }
    }

    const result = matchTemplate(liveLandmarks, [selectedPose.template])
    const status: AlignmentStatus = !result.personVisible
      ? 'finding'
      : result.score >= 0.92
        ? 'close'
        : 'adjusting'

    return {
      status,
      score: result.score,
    }
  }, [cameraState.status, liveLandmarks, selectedPose])

  const galleryLoop = useMemo(() => [...galleryPoses, ...galleryPoses], [galleryPoses])
  const galleryBusy = generationStatus === 'capturing' || generationStatus === 'generating'
  const hasGeneratedGallery = generationStatus === 'ready'

  const handleGeneratePoses = useCallback(async () => {
    if (cameraState.status !== 'ready' || !videoRef.current || galleryBusy) return

    setGenerationStatus('capturing')
    setGenerationError(null)
    setGenerationProgress({ current: 0, total: 10 })

    try {
      const frame = await captureVideoFrame(videoRef.current)
      const job = await createPoseVariantJob(frame, BACKEND_URL)
      setGenerationJobId(job.job_id)
      setGenerationProgress({ current: job.progress, total: job.total })
      setGenerationStatus('generating')
    } catch (err) {
      setGalleryPoses(GALLERY_POSES)
      setSelectedPoseId(GALLERY_POSES[0].id)
      setGenerationJobId(null)
      setGenerationStatus('failed')
      setGenerationError(err instanceof Error ? err.message : String(err))
    }
  }, [cameraState.status, galleryBusy])

  useEffect(() => {
    if (!generationJobId || generationStatus !== 'generating') return

    const applyJob = (jobId: string) => {
      void getPoseVariantJob(jobId, BACKEND_URL)
        .then((job) => {
          setGenerationProgress({ current: job.progress, total: job.total })

          if (job.status === 'ready') {
            const generated = job.results.map(galleryPoseFromResult)
            if (generated.length !== 10) {
              throw new Error('Pose generation returned an incomplete gallery.')
            }
            setGalleryPoses(generated)
            setSelectedPoseId(generated[0].id)
            setGenerationStatus('ready')
            setGenerationJobId(null)
            return
          }

          if (job.status === 'failed') {
            setGalleryPoses(GALLERY_POSES)
            setSelectedPoseId(GALLERY_POSES[0].id)
            setGenerationStatus('failed')
            setGenerationJobId(null)
            setGenerationError(job.error ?? 'Pose generation failed.')
          }
        })
        .catch((err) => {
          setGalleryPoses(GALLERY_POSES)
          setSelectedPoseId(GALLERY_POSES[0].id)
          setGenerationStatus('failed')
          setGenerationJobId(null)
          setGenerationError(err instanceof Error ? err.message : String(err))
        })
    }

    const firstPoll = window.setTimeout(() => applyJob(generationJobId), 400)
    const interval = window.setInterval(() => applyJob(generationJobId), 2500)
    return () => {
      window.clearTimeout(firstPoll)
      window.clearInterval(interval)
    }
  }, [generationJobId, generationStatus])

  const launchMessage =
    cameraState.status === 'idle'
      ? 'Allow camera access to place a white pose guide over your live preview.'
      : cameraState.status === 'requesting'
        ? 'Opening camera...'
        : cameraState.status === 'denied' ||
            cameraState.status === 'unavailable' ||
            cameraState.status === 'error'
          ? cameraState.message
          : ''

  const alignmentCopy = getAlignmentCopy(alignment.status)
  const generationCopy =
    generationStatus === 'capturing'
      ? 'Capturing'
      : generationStatus === 'generating'
        ? `${generationProgress.current}/${generationProgress.total}`
        : hasGeneratedGallery
          ? 'Regenerate'
          : 'Generate'

  return (
    <div className="app-shell">
      <main className="stage-two-shell">
        <section className="camera-preview" data-camera-state={cameraState.status}>
          <video ref={videoRef} className="preview-video" playsInline muted />

          {cameraState.status === 'ready' && (
            <PoseOverlay
              videoRef={videoRef}
              targetTemplate={selectedPose.template}
              mirrored
            />
          )}

          <div className="camera-vignette" aria-hidden="true" />

          {cameraState.status === 'ready' && (
            <>
              <div className="camera-top-bar" aria-live="polite">
                <span className="camera-brand">frame-mog</span>
                <div className="camera-actions">
                  <span className={`alignment-pill ${alignment.status}`}>
                    {alignmentCopy}
                  </span>
                  <button
                    className="generate-button"
                    type="button"
                    onClick={() => void handleGeneratePoses()}
                    disabled={galleryBusy}
                  >
                    {generationCopy}
                  </button>
                </div>
              </div>

              <div className="camera-bottom-hint" aria-live="polite">
                <span>{selectedPose.instruction}</span>
                {landmarkerError && (
                  <small>Pose tracker: {landmarkerError}</small>
                )}
              </div>
            </>
          )}

          {cameraState.status !== 'ready' && (
            <div className="camera-launch">
              <div className="launch-mark" aria-hidden="true" />
              <p className="launch-kicker">Mobile pose camera</p>
              <h1>Line up before the shot.</h1>
              <p className={cameraState.status === 'idle' || cameraState.status === 'requesting' ? '' : 'error'}>
                {launchMessage}
              </p>
              {cameraState.status !== 'requesting' &&
                cameraState.status !== 'unavailable' && (
                  <button type="button" onClick={() => void requestCamera()}>
                    {cameraState.status === 'idle' ? 'Enable camera' : 'Retry camera'}
                  </button>
                )}
            </div>
          )}
        </section>

        <section className="pose-gallery" aria-label="Generated pose gallery">
          <div className="gallery-heading">
            <div>
              <p>
                {galleryBusy
                  ? 'Generating with OpenAI'
                  : hasGeneratedGallery
                    ? 'Generated poses'
                    : generationStatus === 'failed'
                      ? 'Fallback poses'
                      : 'Demo fallback'}
              </p>
              <h2>{galleryBusy ? 'Creating pose set' : selectedPose.title}</h2>
            </div>
            <span>
              {galleryBusy
                ? `${generationProgress.current}/${generationProgress.total}`
                : `${String(galleryPoses.findIndex((pose) => pose.id === selectedPose.id) + 1).padStart(2, '0')} / 10`}
            </span>
          </div>
          {generationError && <p className="gallery-error">{generationError}</p>}

          <div className="gallery-rail">
            <div className="gallery-track">
              {galleryBusy &&
                Array.from({ length: 10 }).map((_, index) => (
                  <div className="pose-card skeleton" key={index}>
                    <span />
                  </div>
                ))}

              {!galleryBusy && galleryLoop.map((pose, index) => {
                const active = pose.id === selectedPose.id
                return (
                  <button
                    className={active ? 'pose-card active' : 'pose-card'}
                    type="button"
                    key={`${pose.id}-${index}`}
                    onClick={() => setSelectedPoseId(pose.id)}
                    aria-pressed={active}
                  >
                    <img src={pose.imageSrc} alt={pose.title} />
                    <span>{pose.title}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
