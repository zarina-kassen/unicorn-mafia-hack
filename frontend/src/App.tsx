import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@clerk/react'

import { useCamera } from './camera/useCamera'
import type { NormalizedLandmark } from './pose/mediapipe'
import { usePoseLandmarker } from './pose/usePoseLandmarker'
import { matchTemplate } from './pose/matcher'
import { PoseOverlay } from './overlay/PoseOverlay'
import { GALLERY_POSES, type GalleryPose } from './pose/galleryTargets'
import {
  ApiError,
  createCheckoutSession,
  createPoseVariantJob,
  getBillingAccount,
  getPoseVariantJob,
  type BillingAccount,
  type PoseVariantResult,
} from './backend/client'
import { Button } from '@/components/ui/button'
import { buildPoseVariantSceneContext } from './pose/sceneContext'

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
  const [billingAccount, setBillingAccount] = useState<BillingAccount | null>(null)
  const [billingMessage, setBillingMessage] = useState<string>('')
  const [checkoutBusy, setCheckoutBusy] = useState(false)

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

    return { status, score: result.score }
  }, [cameraState.status, liveLandmarks, selectedPose])

  const galleryLoop = useMemo(
    () => (galleryPoses.length > 0 ? [...galleryPoses, ...galleryPoses] : []),
    [galleryPoses],
  )
  const galleryBusy = generationStatus === 'capturing' || generationStatus === 'generating'
  const hasGeneratedGallery = generationStatus === 'ready'

  const refreshBilling = useCallback(async () => {
    try {
      const account = await getBillingAccount(BACKEND_URL, getToken)
      setBillingAccount(account)
    } catch {
      setBillingAccount(null)
    }
  }, [getToken])

  useEffect(() => {
    const t = setTimeout(() => {
      void refreshBilling()
    }, 0)
    return () => clearTimeout(t)
  }, [refreshBilling])

  const handleBuyCredits = useCallback(
    async (packId: 'pack_100' | 'pack_200') => {
      setCheckoutBusy(true)
      setBillingMessage('')
      try {
        const currentUrl = window.location.href
        const session = await createCheckoutSession(
          { pack_id: packId, success_url: currentUrl, cancel_url: currentUrl },
          BACKEND_URL,
          getToken,
        )
        window.location.href = session.checkout_url
      } catch (err) {
        setBillingMessage(err instanceof Error ? err.message : 'Could not launch checkout.')
      } finally {
        setCheckoutBusy(false)
      }
    },
    [getToken],
  )

  const handleGeneratePoses = useCallback(async () => {
    if (cameraState.status !== 'ready' || !videoRef.current || galleryBusy) return

    setGenerationStatus('capturing')
    setGenerationError(null)
    setGenerationProgress({ current: 0, total: 10 })

    try {
      const video = videoRef.current
      const scene = buildPoseVariantSceneContext(
        liveLandmarks,
        video.videoWidth,
        video.videoHeight,
      )
      const frame = await captureVideoFrame(video)
      const job = await createPoseVariantJob(frame, BACKEND_URL, getToken, scene)
      void refreshBilling()
      setGenerationJobId(job.job_id)
      setGenerationProgress({ current: job.progress, total: job.total })
      setGenerationStatus('generating')
    } catch (err) {
      setGalleryPoses(GALLERY_POSES)
      setSelectedPoseId(GALLERY_POSES[0].id)
      setGenerationJobId(null)
      setGenerationStatus('failed')
      if (err instanceof ApiError && err.detail?.remaining_credits !== undefined) {
        setGenerationError(`${err.message} Remaining credits: ${err.detail.remaining_credits}.`)
      } else {
        setGenerationError(err instanceof Error ? err.message : String(err))
      }
    }
  }, [cameraState.status, galleryBusy, getToken, liveLandmarks, refreshBilling])

  useEffect(() => {
    if (!generationJobId || generationStatus !== 'generating') return

    const applyJob = (jobId: string) => {
      void getPoseVariantJob(jobId, BACKEND_URL, getToken)
        .then((job) => {
          setGenerationProgress({ current: job.progress, total: job.total })

          if (job.results.length > 0) {
            const generated = job.results.map(galleryPoseFromResult)
            setGalleryPoses(generated)
            setSelectedPoseId((previous) =>
              generated.some((pose) => pose.id === previous) ? previous : generated[0]?.id ?? previous,
            )
          }

          if (job.status === 'ready') {
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
        .catch(() => {
          setGalleryPoses(GALLERY_POSES)
          setSelectedPoseId(GALLERY_POSES[0].id)
          setGenerationStatus('failed')
          setGenerationJobId(null)
          setGenerationError('Pose generation status failed.')
        })
    }

    const firstPoll = window.setTimeout(() => applyJob(generationJobId), 400)
    const interval = window.setInterval(() => applyJob(generationJobId), 2500)
    return () => {
      window.clearTimeout(firstPoll)
      window.clearInterval(interval)
    }
  }, [generationJobId, generationStatus, getToken])

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
    <div className="min-h-screen min-h-dvh overflow-x-hidden">
      <main className="stage-two-shell">
        <section className="camera-preview" data-camera-state={cameraState.status}>
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full -scale-x-100 bg-cam-surface object-cover"
            playsInline
            muted
          />

          {cameraState.status === 'ready' && (
            <PoseOverlay videoRef={videoRef} targetTemplate={selectedPose.template} mirrored />
          )}

          <div className="camera-vignette" aria-hidden="true" />

          {cameraState.status === 'ready' && (
            <>
              <div
                className="absolute left-4 right-4 top-4 z-[2] flex items-center justify-between gap-3"
                style={{ textShadow: 'var(--shadow-cam-text)' }}
                aria-live="polite"
              >
                <span className="text-[0.76rem] font-black uppercase tracking-[0.13em]">
                  frame-mog
                </span>
                <div className="flex items-center gap-2">
                  {billingAccount && (
                    <span className="credit-pill text-[0.76rem] font-black">
                      Credits {billingAccount.balance}
                    </span>
                  )}
                  <span className={`alignment-pill ${alignment.status}`}>
                    {alignmentCopy}
                  </span>
                  <Button
                    className="generate-button"
                    type="button"
                    onClick={() => void handleGeneratePoses()}
                    disabled={galleryBusy}
                  >
                    {generationCopy}
                  </Button>
                </div>
              </div>

              <div
                className="absolute inset-x-[18px] bottom-5 z-[2] flex flex-col items-center gap-2 text-center"
                style={{ textShadow: 'var(--shadow-cam-text-heavy)' }}
                aria-live="polite"
              >
                <span className="camera-hint-pill max-w-[min(410px,88vw)] rounded-full border border-cam-hairline bg-black/[0.38] px-[15px] py-2.5 text-[0.9rem] font-[850] leading-[1.25] backdrop-blur-[18px]">
                  {selectedPose.instruction}
                </span>
                {landmarkerError && (
                  <small className="max-w-[min(320px,88vw)] text-[0.72rem] text-cam-error-soft">
                    Pose tracker: {landmarkerError}
                  </small>
                )}

              </div>

              <button
                className="shutter-button"
                type="button"
                onClick={() => void handleGeneratePoses()}
                disabled={galleryBusy}
                aria-label={generationCopy}
              >
                <span />
              </button>

              <section className="pose-gallery" aria-label="Generated pose gallery">
                <div className="gallery-heading">
                  <button className="gallery-nav" type="button" aria-label="Previous">
                    ‹
                  </button>
                  <div>
                    <p>{galleryBusy ? 'AI POSE RECOMMENDATIONS' : 'POSE RECOMMENDATIONS'}</p>
                    <h2>{galleryBusy ? 'Generating...' : selectedPose.title}</h2>
                  </div>
                  <button className="gallery-nav" type="button" aria-label="Close">
                    ✕
                  </button>
                </div>
                {generationError && <p className="gallery-error">{generationError}</p>}

                <div className="gallery-rail">
                  <div className="gallery-track">
                    {galleryBusy &&
                      galleryPoses.map((pose) => {
                        const active = pose.id === selectedPose.id
                        return (
                          <button
                            className={active ? 'pose-card active' : 'pose-card'}
                            type="button"
                            key={pose.id}
                            onClick={() => setSelectedPoseId(pose.id)}
                            aria-pressed={active}
                          >
                            <img src={pose.imageSrc} alt={pose.title} />
                            <span>{pose.title}</span>
                          </button>
                        )
                      })}

                    {galleryBusy &&
                      Array.from({ length: Math.max(0, generationProgress.total - galleryPoses.length) }).map((_, index) => (
                        <div className="pose-card skeleton" key={index}>
                          <span />
                        </div>
                      ))}

                    {!galleryBusy &&
                      galleryLoop.map((pose, index) => {
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
            </>
          )}

          {cameraState.status !== 'ready' && (
            <div className="camera-launch">
              <div className="launch-mark" aria-hidden="true" />
              <p className="mt-2 -mb-1.5 text-[0.72rem] font-black uppercase tracking-[0.14em] text-cam-accent">
                Mobile pose camera
              </p>
              <h1 className="m-0 max-w-[310px] text-[clamp(2.2rem,11vw,3.8rem)] leading-[0.92] tracking-[-0.07em]">
                Line up before the shot.
              </h1>
              <p className={`m-0 max-w-[300px] text-[0.98rem] leading-[1.45] ${cameraState.status === 'idle' || cameraState.status === 'requesting' ? 'text-cam-ink-muted' : 'text-cam-error'}`}>
                {launchMessage}
              </p>
              {cameraState.status !== 'requesting' &&
                cameraState.status !== 'unavailable' && (
                  <Button
                    variant="outline"
                    className="camera-launch-btn mt-1.5 h-auto min-w-[178px] rounded-full border-cam-active-border bg-cam-button-face dark:bg-cam-button-face px-5 py-3.5 font-black text-cam-inverse dark:text-cam-inverse hover:bg-cam-button-face/90 hover:text-cam-inverse dark:hover:bg-cam-button-face/90 dark:hover:text-cam-inverse shadow-[var(--shadow-cam-launch-btn)]"
                    onClick={() => void requestCamera()}
                  >
                    {cameraState.status === 'idle' ? 'Enable camera' : 'Retry camera'}
                  </Button>
                )}
            </div>
          )}
        </section>

        <section className="pose-gallery" aria-label="Generated pose gallery">
          <div className="flex items-end justify-between gap-3.5 px-4 pb-[13px]">
            <div>
              <p className="m-0 text-[0.72rem] font-black uppercase tracking-[0.14em] text-cam-ink-muted">
                {galleryBusy
                  ? 'Generating with OpenAI'
                  : hasGeneratedGallery
                    ? 'Generated poses'
                    : generationStatus === 'failed'
                      ? 'Fallback poses'
                      : 'Demo fallback'}
              </p>
              <h2 className="m-0 mt-0.5 text-[clamp(1.35rem,6vw,2rem)] leading-none tracking-[-0.055em]">
                {galleryBusy ? 'Creating pose set' : selectedPose.title}
              </h2>
            </div>
            <span className="text-[0.82rem] font-black text-cam-accent">
              {galleryBusy
                ? `${generationProgress.current}/${generationProgress.total}`
                : `${String(galleryPoses.findIndex((pose) => pose.id === selectedPose.id) + 1).padStart(2, '0')} / ${galleryPoses.length}`}
            </span>
          </div>
          {generationError && (
            <p className="mx-4 -mt-1 mb-3 text-[0.78rem] leading-[1.3] text-cam-error">
              {generationError}
            </p>
          )}

          <div className="mb-2 flex flex-wrap items-center justify-center gap-2 px-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="generate-button h-8 min-w-0 text-xs"
              disabled={checkoutBusy}
              onClick={() => void handleBuyCredits('pack_100')}
            >
              Buy 100 credits
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="generate-button h-8 min-w-0 text-xs"
              disabled={checkoutBusy}
              onClick={() => void handleBuyCredits('pack_200')}
            >
              Buy 200 credits
            </Button>
            {billingMessage && (
              <span className="w-full text-center text-[0.72rem] text-cam-ink-muted">{billingMessage}</span>
            )}
          </div>

          <div className="gallery-rail">
            <div className="gallery-track">
              {galleryBusy &&
                Array.from({ length: Math.max(0, generationProgress.total - galleryPoses.length) }).map((_, index) => (
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
