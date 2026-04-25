import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@clerk/react'

import { useCamera } from './camera/useCamera'
import type { NormalizedLandmark } from './pose/mediapipe'
import { usePoseLandmarker } from './pose/usePoseLandmarker'
import { matchTemplate } from './pose/matcher'
import { PoseOverlay } from './overlay/PoseOverlay'
import { GALLERY_POSES, type GalleryPose } from './pose/galleryTargets'
import {
  createPoseVariantJob,
  getPoseVariantJob,
  postMemoryFeedback,
  postMemoryOnboarding,
  postMemoryPreferences,
  postMemoryReset,
  type MemorySeedEntryPayload,
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

async function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

async function buildSeedEntry(file: File): Promise<MemorySeedEntryPayload> {
  const size = await readImageSize(file)
  const ratio = size ? size.width / Math.max(1, size.height) : 1
  const composition_tags =
    ratio > 1.2
      ? ['landscape_frame', 'wide_composition']
      : ratio < 0.85
        ? ['portrait_frame', 'tight_subject']
        : ['balanced_frame']
  return {
    source_ref: file.name,
    pose_tags: [],
    style_tags: ['camera_roll_like'],
    composition_tags,
    scene_tags: ['camera_roll_seed'],
    confidence: 0.8,
  }
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
  const { getToken } = useAuth()
  const videoRef = useRef<HTMLVideoElement>(null)
  const { state: cameraState, request: requestCamera } = useCamera(videoRef)
  const [galleryPoses, setGalleryPoses] = useState<GalleryPose[]>(GALLERY_POSES)
  const [selectedPoseId, setSelectedPoseId] = useState(GALLERY_POSES[0].id)
  const [liveLandmarks, setLiveLandmarks] = useState<NormalizedLandmark[] | null>(null)
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle')
  const [generationJobId, setGenerationJobId] = useState<string | null>(null)
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 10 })
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [seedStatus, setSeedStatus] = useState<'idle' | 'uploading' | 'done' | 'failed'>('idle')
  const [seedMessage, setSeedMessage] = useState<string>('')
  const [privacyStatus, setPrivacyStatus] = useState<string>('')
  const closeFeedbackRef = useRef<string | null>(null)

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
      const job = await createPoseVariantJob(frame, BACKEND_URL, getToken)
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
  }, [cameraState.status, galleryBusy, getToken])

  useEffect(() => {
    if (!generationJobId || generationStatus !== 'generating') return

    const applyJob = (jobId: string) => {
      void getPoseVariantJob(jobId, BACKEND_URL, getToken)
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
  }, [generationJobId, generationStatus, getToken])

  useEffect(() => {
    if (alignment.status !== 'close') return
    if (closeFeedbackRef.current === selectedPose.id) return
    closeFeedbackRef.current = selectedPose.id
    void postMemoryFeedback(
      {
        event: 'overlay_completed',
        pose_template_id: selectedPose.template.id,
        scene_tags: ['camera_live'],
        outcome_score: 0.9,
      },
      BACKEND_URL,
      getToken,
    )
  }, [alignment.status, selectedPose.id, selectedPose.template.id, getToken])

  const handleSeedImages = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []).slice(0, 5)
      if (files.length === 0) return
      setSeedStatus('uploading')
      setSeedMessage('')
      try {
        const entries = await Promise.all(files.map(buildSeedEntry))
        const ok = await postMemoryOnboarding(entries, BACKEND_URL, getToken)
        if (!ok) throw new Error('seed failed')
        setSeedStatus('done')
        setSeedMessage('Taste profile updated from selected photos.')
      } catch {
        setSeedStatus('failed')
        setSeedMessage('Could not seed memory. Try again after sign-in.')
      } finally {
        event.target.value = ''
      }
    },
    [getToken],
  )

  const handlePreferences = useCallback(
    async (allow_camera_roll: boolean, allow_instagram: boolean, allow_pinterest: boolean) => {
      const ok = await postMemoryPreferences(
        { allow_camera_roll, allow_instagram, allow_pinterest },
        BACKEND_URL,
        getToken,
      )
      setPrivacyStatus(ok ? 'Preferences saved.' : 'Could not save preferences.')
    },
    [getToken],
  )

  const handleResetMemory = useCallback(
    async (hardReset: boolean) => {
      const ok = await postMemoryReset(hardReset, BACKEND_URL, getToken)
      setPrivacyStatus(ok ? 'Memory reset request saved.' : 'Could not reset memory.')
    },
    [getToken],
  )

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
                {seedMessage && <small>{seedMessage}</small>}
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
            <div className="memory-seed-row">
              <label className="generate-button" style={{ cursor: 'pointer' }}>
                Seed taste (up to 5 photos)
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => void handleSeedImages(event)}
                  style={{ display: 'none' }}
                />
              </label>
              {seedStatus === 'uploading' && <span>Seeding memory...</span>}
            </div>
            <div className="memory-controls-row">
              <button
                className="generate-button"
                type="button"
                onClick={() => void handlePreferences(true, false, false)}
              >
                Camera-roll only
              </button>
              <button
                className="generate-button"
                type="button"
                onClick={() => void handlePreferences(true, true, true)}
              >
                Enable all sources
              </button>
              <button
                className="generate-button"
                type="button"
                onClick={() => void handleResetMemory(false)}
              >
                Soft reset memory
              </button>
            </div>
            {privacyStatus && (
              <div className="memory-status">{privacyStatus}</div>
            )}
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
                    onClick={() => {
                      setSelectedPoseId(pose.id)
                      void postMemoryFeedback(
                        {
                          event: 'candidate_selected',
                          pose_template_id: pose.template.id,
                          scene_tags: ['camera_live', 'gallery_choice'],
                          outcome_score: active ? 0.5 : 0.75,
                        },
                        BACKEND_URL,
                        getToken,
                      )
                    }}
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
