import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAuth } from '@clerk/react'

import {
  compositeMirroredVideoWithOverlay,
  makeCaptureFilename,
  tryShareOrDownload,
} from './camera/saveAlignedComposite'
import { useCamera } from './camera/useCamera'
import { PoseOverlay } from './overlay/PoseOverlay'
import { extractPoseGuideFromGeneratedImage } from './pose/extractPoseFromImage'
import { GALLERY_POSES, type GalleryPose } from './pose/galleryTargets'
import { getTemplate } from './pose/templates'
import {
  createPoseVariantJob,
  type PoseVariantResult,
  subscribePoseVariantJob,
  uploadOnboardingGalleryImages,
} from './backend/client'
import { Button } from '@/components/ui/button'
import './App.css'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''
const ONBOARDING_STORAGE_KEY = 'frame-mog-onboarding-gallery-v1'

/** Visible strip when the pose gallery sheet is collapsed (px). */
const GALLERY_SHEET_PEEK_PX = 80

type GenerationStatus = 'idle' | 'capturing' | 'generating' | 'ready' | 'failed'

interface SessionCapture {
  id: string
  blob: Blob
  previewUrl: string
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
  const galleryMatch = GALLERY_POSES.find((pose) => pose.id === result.pose_template_id)
  const template = galleryMatch?.template ?? getTemplate(result.pose_template_id)

  return {
    id: result.id,
    title: result.title,
    instruction: result.instruction,
    imageSrc: backendAssetUrl(result.image_url),
    replaceableAsset: result.replaceable,
    template,
  }
}

function App() {
  const { getToken } = useAuth()
  const videoRef = useRef<HTMLVideoElement>(null)
  const poseOverlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const { state: cameraState, request: requestCamera } = useCamera(videoRef)
  const [galleryPoses, setGalleryPoses] = useState<GalleryPose[]>([])
  /** LLM-provided person mask image for each generated pose id. */
  const [photoMaskById, setPhotoMaskById] = useState<Record<string, string>>({})
  /** Explicit per-pose extraction failure details from strict LLM-only path. */
  const [maskErrorById, setMaskErrorById] = useState<Record<string, string>>({})
  const outlineExtractionStartedRef = useRef(new Set<string>())
  const [selectedPoseId, setSelectedPoseId] = useState<string | null>(null)
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle')
  const [generationJobId, setGenerationJobId] = useState<string | null>(null)
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 6 })
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [onboardingDone, setOnboardingDone] = useState(false)
  const [onboardingFiles, setOnboardingFiles] = useState<File[]>([])
  const [onboardingBusy, setOnboardingBusy] = useState(false)
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const [allowGalleryLearning, setAllowGalleryLearning] = useState(true)

  const gallerySheetRef = useRef<HTMLElement>(null)
  const galleryMaxYRef = useRef(0)
  const gallerySheetYRef = useRef(0)
  const galleryDragRef = useRef<{
    pointerId: number
    startClientY: number
    startTranslate: number
  } | null>(null)
  const [gallerySheetY, setGallerySheetY] = useState(0)
  const [gallerySheetMaxY, setGallerySheetMaxY] = useState(0)
  const [gallerySheetDragging, setGallerySheetDragging] = useState(false)
  const [shutterFlashActive, setShutterFlashActive] = useState(false)
  const [sessionCaptures, setSessionCaptures] = useState<SessionCapture[]>([])
  const [captureError, setCaptureError] = useState<string | null>(null)
  const sessionCapturesRef = useRef<SessionCapture[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const alreadyDone = window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'done'
    setOnboardingDone(alreadyDone)
  }, [])

  useEffect(() => {
    gallerySheetYRef.current = gallerySheetY
  }, [gallerySheetY])

  const galleryPosesRef = useRef<GalleryPose[]>([])
  useEffect(() => {
    galleryPosesRef.current = galleryPoses
  }, [galleryPoses])

  useEffect(() => {
    sessionCapturesRef.current = sessionCaptures
  }, [sessionCaptures])

  useEffect(() => {
    return () => {
      for (const capture of sessionCapturesRef.current) {
        URL.revokeObjectURL(capture.previewUrl)
      }
    }
  }, [])

  const finishOnboarding = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'done')
    }
    setOnboardingDone(true)
  }, [])

  const handleOnboardingFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Array.from(event.target.files ?? []).slice(0, 5)
    setOnboardingFiles(next)
    setOnboardingError(null)
  }, [])

  const handleOnboardingSubmit = useCallback(async () => {
    if (onboardingFiles.length === 0 || onboardingBusy || !allowGalleryLearning) return
    setOnboardingBusy(true)
    setOnboardingError(null)
    try {
      const result = await uploadOnboardingGalleryImages(onboardingFiles, BACKEND_URL, getToken, {
        allowCameraRoll: allowGalleryLearning,
      })
      if (!result.ok) {
        setOnboardingError(result.message)
        return
      }
      finishOnboarding()
    } catch (err) {
      setOnboardingError(err instanceof Error ? err.message : 'Onboarding upload failed.')
    } finally {
      setOnboardingBusy(false)
    }
  }, [allowGalleryLearning, finishOnboarding, getToken, onboardingBusy, onboardingFiles])

  const selectedPose = useMemo((): GalleryPose | null => {
    if (!selectedPoseId) return null
    return galleryPoses.find((pose) => pose.id === selectedPoseId) ?? null
  }, [galleryPoses, selectedPoseId])

  const galleryBusy = generationStatus === 'capturing' || generationStatus === 'generating'
  const hasGeneratedGallery = generationStatus === 'ready'
  /** Outline only for the pose the user explicitly picked in the gallery. */
  const showPoseGuide = selectedPose !== null

  const outlineReadyForSelected =
    selectedPoseId !== null &&
    Boolean(photoMaskById[selectedPoseId]) &&
    !maskErrorById[selectedPoseId]

  const canTakePicture =
    cameraState.status === 'ready' && !galleryBusy && outlineReadyForSelected

  const lastSessionCapture = sessionCaptures[0] ?? null

  const galleryVisible =
    cameraState.status === 'ready' &&
    (galleryBusy || galleryPoses.length > 0 || generationError)

  const measureGallerySheet = useCallback(() => {
    const el = gallerySheetRef.current
    if (!el) return
    const h = el.getBoundingClientRect().height
    const maxY = Math.max(0, h - GALLERY_SHEET_PEEK_PX)
    galleryMaxYRef.current = maxY
    setGallerySheetMaxY(maxY)
    setGallerySheetY((y) => (maxY > 0 ? Math.min(y, maxY) : 0))
  }, [])

  useLayoutEffect(() => {
    if (!galleryVisible) {
      setGallerySheetY(0)
      galleryMaxYRef.current = 0
      setGallerySheetMaxY(0)
      return
    }
    measureGallerySheet()
    const el = gallerySheetRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measureGallerySheet())
    ro.observe(el)
    return () => ro.disconnect()
  }, [galleryVisible, measureGallerySheet, galleryPoses.length, galleryBusy, generationError])

  const handleGeneratePoses = useCallback(async () => {
    if (cameraState.status !== 'ready' || !videoRef.current || galleryBusy) return

    setGenerationStatus('capturing')
    setGenerationError(null)
    setGenerationProgress({ current: 0, total: 6 })
    setGalleryPoses([])
    outlineExtractionStartedRef.current.clear()
    setPhotoMaskById({})
    setMaskErrorById({})
    setSelectedPoseId(null)

    try {
      const frame = await captureVideoFrame(videoRef.current)
      const job = await createPoseVariantJob(frame, BACKEND_URL)
      setGenerationJobId(job.job_id)
      setGenerationProgress({ current: job.progress, total: job.total })
      setGenerationStatus('generating')
    } catch (err) {
      setGalleryPoses([])
      outlineExtractionStartedRef.current.clear()
      setPhotoMaskById({})
      setMaskErrorById({})
      setSelectedPoseId(null)
      setGenerationJobId(null)
      setGenerationStatus('failed')
      setGenerationError(err instanceof Error ? err.message : String(err))
    }
  }, [cameraState.status, galleryBusy])

  const onShutterClick = useCallback(async () => {
    if (!canTakePicture || !videoRef.current) return
    const overlay = poseOverlayCanvasRef.current
    if (!overlay) return

    if (
      typeof window !== 'undefined' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setShutterFlashActive(true)
    }
    setCaptureError(null)
    try {
      const blob = await compositeMirroredVideoWithOverlay(videoRef.current, overlay)
      const filename = makeCaptureFilename()
      await tryShareOrDownload(blob, filename)
      setSessionCaptures((previous) => {
        const previewUrl = URL.createObjectURL(blob)
        const item: SessionCapture = { id: crypto.randomUUID(), blob, previewUrl }
        const next = [item, ...previous].slice(0, 5)
        if (previous.length >= 5) {
          URL.revokeObjectURL(previous[4].previewUrl)
        }
        return next
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save photo.'
      setCaptureError(message)
      window.setTimeout(() => setCaptureError(null), 4200)
    }
  }, [canTakePicture])

  const onSaveLastCaptureAgain = useCallback(() => {
    const capture = lastSessionCapture
    if (!capture) return
    void tryShareOrDownload(capture.blob, makeCaptureFilename())
  }, [lastSessionCapture])

  const onShutterFlashAnimationEnd = useCallback((event: React.AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    setShutterFlashActive(false)
  }, [])

  useEffect(() => {
    if (!generationJobId || generationStatus !== 'generating') return

    const unsubscribe = subscribePoseVariantJob(
      generationJobId,
      (event) => {
        try {
          setGenerationProgress({ current: event.job.progress, total: event.job.total })

          if (event.job.results.length > 0) {
            const generated = event.job.results.map(galleryPoseFromResult)
            setGalleryPoses(generated)
            setSelectedPoseId((previous) =>
              previous !== null && generated.some((pose) => pose.id === previous)
                ? previous
                : null,
            )
          }

          if (event.job.status === 'ready') {
            setGenerationStatus('ready')
            setGenerationJobId(null)
            return
          }

          if (event.job.status === 'failed') {
            setGalleryPoses([])
            outlineExtractionStartedRef.current.clear()
            setPhotoMaskById({})
            setMaskErrorById({})
            setSelectedPoseId(null)
            setGenerationStatus('failed')
            setGenerationJobId(null)
            setGenerationError(event.job.error ?? 'Pose generation failed.')
          }
        } catch (err) {
          console.error('[pose variants] event handler', err)
          setGenerationStatus('failed')
          setGenerationJobId(null)
          setGenerationError(err instanceof Error ? err.message : 'Could not update gallery.')
        }
      },
      () => {
        setGenerationJobId(null)
        const poses = galleryPosesRef.current
        if (poses.length > 0) {
          setGenerationStatus('ready')
          setGenerationError(
            'Live connection dropped, but your photos below are still available. Tap Regenerate anytime to run again.',
          )
          return
        }
        setGalleryPoses([])
        outlineExtractionStartedRef.current.clear()
        setPhotoMaskById({})
        setMaskErrorById({})
        setSelectedPoseId(null)
        setGenerationStatus('failed')
        setGenerationError(
          'Live updates disconnected before any photos arrived. Check your connection and tap Generate.',
        )
      },
      BACKEND_URL,
    )
    return () => unsubscribe()
  }, [generationJobId, generationStatus])

  useEffect(() => {
    for (const pose of galleryPoses) {
      if (outlineExtractionStartedRef.current.has(pose.id)) continue
      outlineExtractionStartedRef.current.add(pose.id)
      void extractPoseGuideFromGeneratedImage(pose.imageSrc).then(
        ({ photoMaskUrl, error }) => {
          if (photoMaskUrl) {
            setPhotoMaskById((prev) => ({ ...prev, [pose.id]: photoMaskUrl }))
            setMaskErrorById((prev) => {
              const next = { ...prev }
              delete next[pose.id]
              return next
            })
          } else if (error) {
            setMaskErrorById((prev) => ({ ...prev, [pose.id]: error }))
          }
        },
      )
    }
  }, [galleryPoses])

  const bottomHintPrimary = useMemo(() => {
    if (captureError) return captureError
    if (galleryBusy) return 'Hang tight while new poses are generated.'
    if (selectedPose) {
      if (outlineReadyForSelected) {
        return `${selectedPose.instruction} Tap the shutter when you are aligned to save a photo.`
      }
      if (selectedPoseId && maskErrorById[selectedPoseId]) {
        return selectedPose.instruction
      }
      return `${selectedPose.instruction} Preparing your outline…`
    }
    if (galleryPoses.length > 0) {
      return 'Tap a pose in the gallery to show its outline guide.'
    }
    return 'Generate poses, then choose one to match.'
  }, [
    captureError,
    galleryBusy,
    selectedPose,
    outlineReadyForSelected,
    selectedPoseId,
    maskErrorById,
    galleryPoses.length,
  ])

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

  const generationCopy =
    generationStatus === 'capturing'
      ? 'Capturing'
      : generationStatus === 'generating'
        ? 'Generating…'
        : hasGeneratedGallery
          ? 'Regenerate'
          : 'Generate'

  const collapseGallerySheet = useCallback(() => {
    const maxY = galleryMaxYRef.current
    if (maxY > 0) setGallerySheetY(maxY)
  }, [])

  useEffect(() => {
    if (!selectedPoseId || !galleryVisible) return
    const handle = window.setTimeout(() => collapseGallerySheet(), 0)
    return () => clearTimeout(handle)
  }, [selectedPoseId, galleryVisible, collapseGallerySheet])

  const onGallerySheetPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return
    galleryDragRef.current = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startTranslate: gallerySheetYRef.current,
    }
    setGallerySheetDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const onGallerySheetPointerMove = useCallback((event: React.PointerEvent) => {
    const drag = galleryDragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const maxY = galleryMaxYRef.current
    if (maxY <= 0) return
    const dy = event.clientY - drag.startClientY
    const next = Math.min(Math.max(0, drag.startTranslate + dy), maxY)
    setGallerySheetY(next)
  }, [])

  const onGallerySheetPointerUp = useCallback((event: React.PointerEvent) => {
    const drag = galleryDragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const totalDy = event.clientY - drag.startClientY
    galleryDragRef.current = null
    setGallerySheetDragging(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // ignore if already released
    }

    setGallerySheetY((prev) => {
      const maxY = galleryMaxYRef.current
      if (maxY <= 0) return 0
      if (Math.abs(totalDy) < 10) {
        if (prev > maxY * 0.88) return 0
        return prev
      }
      return prev > maxY / 2 ? maxY : 0
    })
  }, [])

  const onGallerySheetPointerCancel = useCallback((event: React.PointerEvent) => {
    const drag = galleryDragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    galleryDragRef.current = null
    setGallerySheetDragging(false)
    setGallerySheetY((prev) => {
      const maxY = galleryMaxYRef.current
      if (maxY <= 0) return 0
      return prev > maxY / 2 ? maxY : 0
    })
  }, [])

  if (!onboardingDone) {
    return (
      <div className="min-h-screen min-h-dvh w-full max-w-none overflow-x-hidden">
        <main className="stage-two-shell">
          <section className="camera-preview">
            <div className="camera-launch">
              <div className="launch-mark" aria-hidden="true" />
              <p className="launch-kicker">Taste onboarding</p>
              <h1>Pick up to 5 gallery photos.</h1>
              <p>
                We use your selected images to learn your style and improve generated pose prompts
                for this account.
              </p>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleOnboardingFileChange}
                disabled={onboardingBusy}
              />
              <p>{onboardingFiles.length}/5 selected</p>
              <label className="mt-2 flex max-w-[min(340px,92vw)] cursor-pointer items-start gap-2 text-left text-[0.9rem] leading-snug text-cam-ink-muted">
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  checked={allowGalleryLearning}
                  onChange={(event) => setAllowGalleryLearning(event.target.checked)}
                  disabled={onboardingBusy}
                />
                <span>
                  Allow using my selected photos to learn my style for pose suggestions (uploaded to
                  the server for analysis).
                </span>
              </label>
              {onboardingError && <p className="error">{onboardingError}</p>}
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => void handleOnboardingSubmit()}
                  disabled={onboardingBusy || onboardingFiles.length === 0 || !allowGalleryLearning}
                >
                  {onboardingBusy ? 'Uploading...' : 'Use selected photos'}
                </Button>
                <Button type="button" variant="outline" onClick={finishOnboarding} disabled={onboardingBusy}>
                  Skip for now
                </Button>
              </div>
            </div>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen min-h-dvh w-full max-w-none overflow-x-hidden">
      <main className="stage-two-shell">
        <section className="camera-preview" data-camera-state={cameraState.status}>
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full -scale-x-100 bg-cam-surface object-cover"
            playsInline
            muted
          />

          {cameraState.status === 'ready' && showPoseGuide && (
            <PoseOverlay
              ref={poseOverlayCanvasRef}
              key={selectedPose.id}
              videoRef={videoRef}
              photoMaskUrl={photoMaskById[selectedPose.id] ?? null}
            />
          )}

          <div className="camera-vignette" aria-hidden="true" />

          {cameraState.status === 'ready' && (
            <>
              <div
                className="camera-top-bar"
                style={{ textShadow: 'var(--shadow-cam-text)' }}
                aria-live="polite"
              >
                <button
                  className="generate-button"
                  type="button"
                  onClick={() => void handleGeneratePoses()}
                  disabled={galleryBusy}
                >
                  {generationCopy}
                </button>
              </div>

              <div className="camera-bottom-hint" aria-live="polite">
                <span>{bottomHintPrimary}</span>
                {lastSessionCapture ? (
                  <small>Tap the round thumbnail to save your last capture again.</small>
                ) : null}
              </div>

              <div className="camera-shutter-bar">
                <div className="camera-shutter-bar__left">
                  <button
                    type="button"
                    className="last-capture-thumb"
                    aria-label="Save the last capture again"
                    disabled={lastSessionCapture === null}
                    onClick={() => void onSaveLastCaptureAgain()}
                  >
                    {lastSessionCapture ? (
                      <img src={lastSessionCapture.previewUrl} alt="" />
                    ) : null}
                  </button>
                </div>
                <div className="camera-shutter-bar__center">
                  <button
                    className="shutter-button"
                    type="button"
                    onClick={() => void onShutterClick()}
                    disabled={!canTakePicture}
                    aria-label={
                      canTakePicture
                        ? 'Take picture and save to device'
                        : 'Choose a pose and wait for the outline guide to take a picture'
                    }
                  >
                    <span />
                  </button>
                </div>
                <div className="camera-shutter-bar__right" aria-hidden="true" />
              </div>

              <div
                className={
                  shutterFlashActive ? 'shutter-flash-overlay is-active' : 'shutter-flash-overlay'
                }
                aria-hidden
                onAnimationEnd={onShutterFlashAnimationEnd}
              />

              {galleryVisible && (
                <section
                  ref={gallerySheetRef}
                  className={
                    gallerySheetDragging ? 'pose-gallery is-dragging' : 'pose-gallery'
                  }
                  aria-label="Generated pose gallery"
                  style={{ transform: `translateY(${gallerySheetY}px)` }}
                  aria-expanded={
                    gallerySheetMaxY <= 0 ? true : gallerySheetY < gallerySheetMaxY * 0.5
                  }
                >
                  <div
                    className="gallery-sheet-chrome"
                    onPointerDown={onGallerySheetPointerDown}
                    onPointerMove={onGallerySheetPointerMove}
                    onPointerUp={onGallerySheetPointerUp}
                    onPointerCancel={onGallerySheetPointerCancel}
                  >
                    <div className="gallery-sheet-handle" aria-hidden="true" />
                    <div className="gallery-heading">
                      <button
                        className="gallery-nav"
                        type="button"
                        aria-label="Previous pose"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        ‹
                      </button>
                      <div>
                        <p>{galleryBusy ? 'AI POSE RECOMMENDATIONS' : 'POSE RECOMMENDATIONS'}</p>
                        <h2>
                          {galleryBusy
                            ? 'Generating…'
                            : selectedPose?.title ?? 'Choose a pose'}
                        </h2>
                      </div>
                      <button
                        className="gallery-nav"
                        type="button"
                        aria-label="Collapse pose gallery"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={collapseGallerySheet}
                      >
                        ✕
                      </button>
                    </div>
                    {(generationError || (selectedPoseId && maskErrorById[selectedPoseId])) && (
                      <p className="gallery-error">
                        {selectedPoseId && maskErrorById[selectedPoseId]
                          ? maskErrorById[selectedPoseId]
                          : generationError}
                      </p>
                    )}
                  </div>

                  <div className="gallery-rail">
                    <div className="gallery-track">
                      {galleryBusy &&
                        galleryPoses.map((pose) => {
                          const active = pose.id === selectedPoseId
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
                        Array.from({
                          length: Math.max(0, generationProgress.total - galleryPoses.length),
                        }).map((_, index) => (
                          <div className="pose-card skeleton" key={`sk-${index}`}>
                            <span />
                          </div>
                        ))}

                      {!galleryBusy &&
                        galleryPoses.map((pose) => {
                          const active = pose.id === selectedPoseId
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
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {cameraState.status !== 'ready' && (
            <div className="camera-launch">
              <div className="launch-mark" aria-hidden="true" />
              <p className="launch-kicker">Mobile pose camera</p>
              <h1>Line up before the shot.</h1>
              <p
                className={
                  cameraState.status === 'idle' || cameraState.status === 'requesting'
                    ? ''
                    : 'error'
                }
              >
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
      </main>
    </div>
  )
}

export default App
