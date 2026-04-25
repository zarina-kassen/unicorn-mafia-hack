import { useCallback, useMemo, useRef, useState } from 'react'

import { useCamera } from './camera/useCamera'
import { usePoseLandmarker } from './pose/usePoseLandmarker'
import { PoseOverlay } from './overlay/PoseOverlay'
import { usePoseVariants } from './hooks/usePoseVariants'
import type { PoseVariantResult } from './api/types'
import { Button } from '@/components/ui/button'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''

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

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { state: cameraState, request: requestCamera } = useCamera(videoRef)
  const [poseTargets, setPoseTargets] = useState<PoseVariantResult[]>([])
  const [generationError, setGenerationError] = useState<string | null>(null)

  const landmarkerEnabled = cameraState.status === 'ready'
  const selectedTarget = useMemo(
    () => poseTargets[0] ?? null,
    [poseTargets],
  )

  const handleLandmarks = useCallback(() => {
    // No-op - we don't use landmarks for guidance anymore
  }, [])

  const { error: landmarkerError } = usePoseLandmarker(
    videoRef,
    landmarkerEnabled,
    handleLandmarks,
  )

  const { createJob } = usePoseVariants()
  
  const generationStatus = createJob.isPending ? 'generating' : poseTargets.length > 0 ? 'ready' : 'idle'
  const galleryBusy = generationStatus === 'generating'
  const hasGeneratedGallery = generationStatus === 'ready'

  const handleGeneratePoses = useCallback(async () => {
    if (cameraState.status !== 'ready' || !videoRef.current || galleryBusy) return

    setGenerationError(null)
    setPoseTargets([])

    try {
      const frame = await captureVideoFrame(videoRef.current)
      const results = await createJob.mutateAsync(frame)
      setPoseTargets(results)
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : String(err))
    }
  }, [cameraState.status, galleryBusy, createJob])

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
    generationStatus === 'generating'
      ? 'Generating...'
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

          {cameraState.status === 'ready' && selectedTarget && (
            <PoseOverlay videoRef={videoRef} targetLandmarks={selectedTarget.target_landmarks} mirrored />
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
                  {selectedTarget?.instruction || 'Generate poses to get started'}
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

              {hasGeneratedGallery && poseTargets.length > 0 && (
                <section className="pose-gallery" aria-label="Generated pose gallery">
                  <div className="gallery-heading">
                    <div>
                      <p>AI POSE RECOMMENDATIONS</p>
                      <h2>{selectedTarget?.title || 'Select a pose'}</h2>
                    </div>
                  </div>
                  {generationError && <p className="gallery-error">{generationError}</p>}

                  <div className="gallery-rail">
                    <div className="gallery-track">
                      {poseTargets.map((target) => (
                        <button
                          className='pose-card'
                          type="button"
                          key={target.id}
                        >
                          <img src={backendAssetUrl(target.image_url)} alt={target.title} />
                          <span>{target.title}</span>
                        </button>
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
      </main>
    </div>
  )
}

export default App
