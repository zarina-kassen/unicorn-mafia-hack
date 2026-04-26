import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  compositeMirroredVideoWithOverlay,
  makeCaptureFilename,
  tryShareOrDownload,
} from './hooks/saveAlignedComposite'
import { useCamera } from './hooks/useCamera'
import { usePoseVariants } from './hooks/usePoseVariants'
import { useOnboarding } from './hooks/useOnboarding'
import { PoseOverlay } from './components/PoseOverlay'
import { Button } from '@/components/ui/button'
import './App.css'

const GALLERY_SHEET_PEEK_PX = 80

interface SessionCapture {
  id: string
  blob: Blob
  previewUrl: string
}

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const poseOverlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const { state: cameraState, request: requestCamera } = useCamera(videoRef)

  const poseVariants = usePoseVariants()
  const {
    done: onboardingDone,
    files,
    setFiles,
    allowLearning,
    setAllowLearning,
    skip: skipOnboarding,
    mutation: onboardingMutation,
  } = useOnboarding()

  const poses = useMemo(() => poseVariants.data ?? [], [poseVariants.data])
  const outlines = poseVariants.outlines
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const activeId = selectedId ?? poses[0]?.id ?? null
  const selectedPose = useMemo(
    () => poses.find((p) => p.id === activeId) ?? null,
    [poses, activeId],
  )

  const galleryBusy = poseVariants.isPending
  const targetTotal =
    poseVariants.expectedCount > 0
      ? poseVariants.expectedCount
      : galleryBusy
        ? 6
        : 0
  const skeletonSlots =
    galleryBusy && targetTotal > poses.length ? targetTotal - poses.length : 0
  const galleryVisible =
    cameraState.status === 'ready' &&
    (galleryBusy || poses.length > 0 || poseVariants.isError)

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
    gallerySheetYRef.current = gallerySheetY
  }, [gallerySheetY])

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

  const outlineForSelected = selectedPose ? outlines[selectedPose.id] : null
  const outlineReadyForSelected =
    selectedPose !== null &&
    Boolean(
      outlineForSelected?.polygon && outlineForSelected.polygon.length >= 3,
    )

  const canTakePicture =
    cameraState.status === 'ready' && !galleryBusy && outlineReadyForSelected

  const lastSessionCapture = sessionCaptures[0] ?? null

  const bottomHintPrimary = useMemo(() => {
    if (captureError) return captureError
    if (galleryBusy) return 'Hang tight while new poses are generated.'
    if (selectedPose) {
      if (outlineReadyForSelected) {
        return `${selectedPose.instruction} Tap the shutter when you are aligned to save a photo.`
      }
      return `${selectedPose.instruction} Preparing your outline…`
    }
    if (poses.length > 0) {
      return 'Tap a pose in the gallery to show its outline guide.'
    }
    return 'Generate poses, then choose one to match.'
  }, [captureError, galleryBusy, selectedPose, outlineReadyForSelected, poses.length])

  const measureGallerySheet = useCallback(() => {
    const el = gallerySheetRef.current
    if (!el) return
    const maxY = Math.max(
      0,
      el.getBoundingClientRect().height - GALLERY_SHEET_PEEK_PX,
    )
    galleryMaxYRef.current = maxY
    setGallerySheetMaxY(maxY)
    setGallerySheetY((y) => (maxY > 0 ? Math.min(y, maxY) : 0))
  }, [])

  useLayoutEffect(() => {
    if (!galleryVisible) {
      galleryMaxYRef.current = 0
      window.requestAnimationFrame(() => {
        setGallerySheetY(0)
        setGallerySheetMaxY(0)
      })
      return
    }
    measureGallerySheet()
    const el = gallerySheetRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measureGallerySheet())
    ro.observe(el)
    return () => ro.disconnect()
  }, [galleryVisible, measureGallerySheet, poses.length, galleryBusy, poseVariants.isError])

  const handleGenerate = useCallback(() => {
    if (cameraState.status !== 'ready' || !videoRef.current || galleryBusy) return
    setSelectedId(null)
    poseVariants.mutate(videoRef.current)
  }, [cameraState.status, galleryBusy, poseVariants])

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
      const blob = await compositeMirroredVideoWithOverlay(
        videoRef.current,
        overlay,
      )
      const filename = makeCaptureFilename()
      await tryShareOrDownload(blob, filename)
      setSessionCaptures((previous) => {
        const previewUrl = URL.createObjectURL(blob)
        const item: SessionCapture = {
          id: crypto.randomUUID(),
          blob,
          previewUrl,
        }
        const next = [item, ...previous].slice(0, 5)
        if (previous.length >= 5) {
          URL.revokeObjectURL(previous[4].previewUrl)
        }
        return next
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not save photo.'
      setCaptureError(message)
      window.setTimeout(() => setCaptureError(null), 4200)
    }
  }, [canTakePicture])

  const onSaveLastCaptureAgain = useCallback(() => {
    const capture = lastSessionCapture
    if (!capture) return
    void tryShareOrDownload(capture.blob, makeCaptureFilename())
  }, [lastSessionCapture])

  const collapseGallerySheet = useCallback(() => {
    const maxY = galleryMaxYRef.current
    if (maxY > 0) setGallerySheetY(maxY)
  }, [])

  useEffect(() => {
    if (!activeId || !galleryVisible) return
    const handle = window.setTimeout(() => collapseGallerySheet(), 0)
    return () => clearTimeout(handle)
  }, [activeId, galleryVisible, collapseGallerySheet])

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return
    galleryDragRef.current = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startTranslate: gallerySheetYRef.current,
    }
    setGallerySheetDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const drag = galleryDragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const maxY = galleryMaxYRef.current
    if (maxY <= 0) return
    setGallerySheetY(
      Math.min(
        Math.max(0, drag.startTranslate + event.clientY - drag.startClientY),
        maxY,
      ),
    )
  }, [])

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    const drag = galleryDragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const totalDy = event.clientY - drag.startClientY
    galleryDragRef.current = null
    setGallerySheetDragging(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    setGallerySheetY((prev) => {
      const maxY = galleryMaxYRef.current
      if (maxY <= 0) return 0
      if (Math.abs(totalDy) < 10) return prev > maxY * 0.88 ? 0 : prev
      return prev > maxY / 2 ? maxY : 0
    })
  }, [])

  const onPointerCancel = useCallback((event: React.PointerEvent) => {
    const drag = galleryDragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    galleryDragRef.current = null
    setGallerySheetDragging(false)
    setGallerySheetY((prev) => {
      const maxY = galleryMaxYRef.current
      return maxY <= 0 ? 0 : prev > maxY / 2 ? maxY : 0
    })
  }, [])

  const generationCopy = poseVariants.isPending
    ? 'Generating…'
    : poseVariants.isSuccess
      ? 'Regenerate'
      : 'Generate'

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
                We use your selected images to learn your style and improve
                generated pose prompts for this account.
              </p>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) =>
                  setFiles(Array.from(e.target.files ?? []).slice(0, 5))
                }
                disabled={onboardingMutation.isPending}
              />
              <p>{files.length}/5 selected</p>
              <label className="mt-2 flex max-w-[min(340px,92vw)] cursor-pointer items-start gap-2 text-left text-[0.9rem] leading-snug text-cam-ink-muted">
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  checked={allowLearning}
                  onChange={(e) => setAllowLearning(e.target.checked)}
                  disabled={onboardingMutation.isPending}
                />
                <span>
                  Allow using my selected photos to learn my style for pose
                  suggestions (uploaded to the server for analysis).
                </span>
              </label>
              {onboardingMutation.isError && (
                <p className="error">
                  {onboardingMutation.error instanceof Error
                    ? onboardingMutation.error.message
                    : 'Upload failed.'}
                </p>
              )}
              {onboardingMutation.isSuccess && !onboardingMutation.data.ok && (
                <p className="error">{onboardingMutation.data.message}</p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => onboardingMutation.mutate()}
                  disabled={
                    onboardingMutation.isPending ||
                    files.length === 0 ||
                    !allowLearning
                  }
                >
                  {onboardingMutation.isPending
                    ? 'Uploading...'
                    : 'Use selected photos'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={skipOnboarding}
                  disabled={onboardingMutation.isPending}
                >
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
        <section
          className="camera-preview"
          data-camera-state={cameraState.status}
        >
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full -scale-x-100 bg-cam-surface object-cover"
            playsInline
            muted
          />

          {cameraState.status === 'ready' && selectedPose && (
            <PoseOverlay
              ref={poseOverlayCanvasRef}
              key={selectedPose.id}
              videoRef={videoRef}
              outline={outlines[selectedPose.id] ?? null}
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
                  onClick={handleGenerate}
                  disabled={galleryBusy}
                >
                  {generationCopy}
                </button>
              </div>

              <div className="camera-bottom-hint" aria-live="polite">
                <span>{bottomHintPrimary}</span>
                {lastSessionCapture ? (
                  <small>
                    Tap the round thumbnail to save your last capture again.
                  </small>
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
                  shutterFlashActive
                    ? 'shutter-flash-overlay is-active'
                    : 'shutter-flash-overlay'
                }
                aria-hidden
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget) setShutterFlashActive(false)
                }}
              />

              {galleryVisible && (
                <section
                  ref={gallerySheetRef}
                  className={
                    gallerySheetDragging
                      ? 'pose-gallery is-dragging'
                      : 'pose-gallery'
                  }
                  aria-label="Generated pose gallery"
                  style={{ transform: `translateY(${gallerySheetY}px)` }}
                  aria-expanded={
                    gallerySheetMaxY <= 0
                      ? true
                      : gallerySheetY < gallerySheetMaxY * 0.5
                  }
                >
                  <div
                    className="gallery-sheet-chrome"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
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
                        <p>
                          {galleryBusy
                            ? 'AI POSE RECOMMENDATIONS'
                            : 'POSE RECOMMENDATIONS'}
                        </p>
                        <h2>
                          {galleryBusy
                            ? 'Generating…'
                            : (selectedPose?.title ?? 'Choose a pose')}
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
                    {poseVariants.isError && (
                      <p className="gallery-error">
                        {poseVariants.error instanceof Error
                          ? poseVariants.error.message
                          : 'Generation failed.'}
                      </p>
                    )}
                  </div>

                  <div className="gallery-rail">
                    <div className="gallery-track">
                      {poses.map((pose) => (
                        <button
                          className={
                            pose.id === activeId ? 'pose-card active' : 'pose-card'
                          }
                          type="button"
                          key={pose.id}
                          onClick={() => setSelectedId(pose.id)}
                          aria-pressed={pose.id === activeId}
                        >
                          <img src={pose.imageSrc} alt={pose.title} />
                          <span>{pose.title}</span>
                        </button>
                      ))}
                      {galleryBusy &&
                        Array.from({ length: skeletonSlots }).map((_, i) => (
                          <div className="pose-card skeleton" key={`sk-${i}`}>
                            <span />
                          </div>
                        ))}
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
                  cameraState.status === 'idle' ||
                  cameraState.status === 'requesting'
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
