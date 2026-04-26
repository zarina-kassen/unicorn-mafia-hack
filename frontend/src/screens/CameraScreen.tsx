import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Images } from 'lucide-react'
import { toast } from 'sonner'

import {
  compositeMirroredVideoWithOverlay,
  makeCaptureFilename,
  tryShareOrDownload,
} from '@/hooks/saveAlignedComposite'
import { useCamera } from '@/hooks/useCamera'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePoseVariants } from '@/hooks/usePoseVariants'
import { CameraFrame } from '@/components/CameraFrame'
import { CameraLaunch } from '@/components/CameraLaunch'
import { CameraTopBar } from '@/components/CameraTopBar'
import { PoseGallery } from '@/components/PoseGallery'
import { PoseOverlay } from '@/components/PoseOverlay'
import { ShutterDock } from '@/components/ShutterDock'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SessionCapture {
  id: string
  blob: Blob
  previewUrl: string
}

export function CameraScreen() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const poseOverlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const { state: cameraState, request: requestCamera } = useCamera(videoRef)
  const poseVariants = usePoseVariants()
  const isMdUp = useMediaQuery('(min-width: 768px)')

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

  const [mobileGalleryOpen, setMobileGalleryOpen] = useState(false)
  const [shutterFlashActive, setShutterFlashActive] = useState(false)
  const [sessionCaptures, setSessionCaptures] = useState<SessionCapture[]>([])
  const sessionCapturesRef = useRef<SessionCapture[]>([])

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
    if (galleryBusy) return 'Hang tight while new poses are generated.'
    if (selectedPose) {
      if (outlineReadyForSelected) {
        return `${selectedPose.instruction} Tap the shutter when you are aligned to save a photo.`
      }
      return `${selectedPose.instruction} Preparing your outline…`
    }
    if (poses.length > 0) {
      return 'Choose a pose in the gallery to show its outline guide.'
    }
    return 'Generate poses, then pick one to match.'
  }, [galleryBusy, selectedPose, outlineReadyForSelected, poses.length])

  const handleGenerate = useCallback(() => {
    if (cameraState.status !== 'ready' || !videoRef.current || galleryBusy)
      return
    setSelectedId(null)
    if (!isMdUp) setMobileGalleryOpen(true)
    poseVariants.mutate(videoRef.current)
  }, [cameraState.status, galleryBusy, poseVariants, isMdUp])

  const handleSelectPose = useCallback(
    (id: string) => {
      setSelectedId(id)
      if (!isMdUp) setMobileGalleryOpen(false)
    },
    [isMdUp],
  )

  const poseIndex = useMemo(() => {
    if (poses.length === 0) return -1
    const i = poses.findIndex((p) => p.id === activeId)
    return i >= 0 ? i : 0
  }, [poses, activeId])

  const onPrevPose = useCallback(() => {
    if (poses.length < 2 || galleryBusy) return
    const next = poseIndex <= 0 ? poses.length - 1 : poseIndex - 1
    handleSelectPose(poses[next].id)
  }, [poses, poseIndex, galleryBusy, handleSelectPose])

  const onNextPose = useCallback(() => {
    if (poses.length < 2 || galleryBusy) return
    const next = poseIndex >= poses.length - 1 ? 0 : poseIndex + 1
    handleSelectPose(poses[next].id)
  }, [poses, poseIndex, galleryBusy, handleSelectPose])

  const onClearSelection = useCallback(() => {
    setSelectedId(null)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return
      }
      if (poses.length === 0 || galleryBusy) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onPrevPose()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onNextPose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [poses.length, galleryBusy, onPrevPose, onNextPose])

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
    try {
      const blob = await compositeMirroredVideoWithOverlay(
        videoRef.current,
        overlay,
      )
      const filename = makeCaptureFilename()
      await tryShareOrDownload(blob, filename)
      toast.success('Photo saved', {
        description: 'Shared or downloaded to your device.',
      })
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
      toast.error('Capture failed', { description: message })
    }
  }, [canTakePicture])

  const onSaveLastCaptureAgain = useCallback(() => {
    const capture = lastSessionCapture
    if (!capture) return
    void tryShareOrDownload(capture.blob, makeCaptureFilename())
      .then(() => toast.success('Saved again'))
      .catch(() => toast.error('Could not save'))
  }, [lastSessionCapture])

  const generationCopy = poseVariants.isPending
    ? 'Generating…'
    : poseVariants.isSuccess
      ? 'Regenerate'
      : 'Generate'

  const galleryPanelProps = {
    poses,
    activeId,
    onSelect: handleSelectPose,
    galleryBusy,
    skeletonSlots,
    isError: poseVariants.isError,
    errorMessage:
      poseVariants.error instanceof Error
        ? poseVariants.error.message
        : poseVariants.isError
          ? 'Generation failed.'
          : null,
    selectedTitle: selectedPose?.title ?? 'Choose a pose',
  }

  const shutterVariant = isMdUp ? 'inline' : 'overlay'

  return (
    <div
      className={cn(
        'relative min-h-dvh w-full overflow-x-hidden',
        'md:mx-auto md:grid md:max-w-6xl md:grid-cols-[minmax(0,1fr)_280px] md:items-start md:gap-6 md:px-4 md:py-6',
        'lg:grid-cols-[minmax(0,1fr)_360px]',
      )}
    >
      <div className="relative md:flex md:min-h-[min(92dvh,960px)] md:flex-col md:justify-center">
        {cameraState.status === 'ready' && (
          <CameraTopBar
            className="mb-3 hidden w-full max-w-[min(420px,42vw)] px-1 md:mx-auto md:flex"
            generationLabel={generationCopy}
            galleryBusy={galleryBusy}
            onGenerate={handleGenerate}
            onPrevPose={onPrevPose}
            onNextPose={onNextPose}
            onClearSelection={onClearSelection}
            poseCount={poses.length}
          />
        )}

        <div className="relative h-dvh w-full md:h-auto md:min-h-0">
          <CameraFrame
            videoRef={videoRef}
            shutterFlashActive={shutterFlashActive}
            onShutterFlashEnd={() => setShutterFlashActive(false)}
            overlay={
              cameraState.status === 'ready' && selectedPose ? (
                <PoseOverlay
                  ref={poseOverlayCanvasRef}
                  key={selectedPose.id}
                  videoRef={videoRef}
                  outline={outlines[selectedPose.id] ?? null}
                />
              ) : null
            }
          />

          {cameraState.status === 'ready' && (
            <>
              <CameraTopBar
                className="absolute left-3 right-3 top-[max(12px,env(safe-area-inset-top,0px))] z-20 md:hidden"
                generationLabel={generationCopy}
                galleryBusy={galleryBusy}
                onGenerate={handleGenerate}
                onPrevPose={onPrevPose}
                onNextPose={onNextPose}
                onClearSelection={onClearSelection}
                poseCount={poses.length}
              />

              <div
                className={cn(
                  'pointer-events-none absolute left-4 right-4 z-[12] flex flex-col items-center gap-2 text-center',
                  'bottom-[calc(200px+env(safe-area-inset-bottom,0px))] md:static md:bottom-auto md:z-auto md:mt-3 md:px-2',
                )}
                aria-live="polite"
                style={{ textShadow: 'var(--shadow-cam-text-heavy)' }}
              >
                <span
                  className={cn(
                    'max-w-md rounded-full border border-cam-hairline bg-black/45 px-4 py-2.5 text-sm font-extrabold text-cam-ink backdrop-blur-md md:text-base',
                  )}
                >
                  {bottomHintPrimary}
                </span>
                {lastSessionCapture ? (
                  <span className="max-w-xs text-xs text-cam-error-soft">
                    Tap the round thumbnail to save your last capture again.
                  </span>
                ) : null}
              </div>

              <ShutterDock
                variant={shutterVariant}
                canTakePicture={canTakePicture}
                onShutter={onShutterClick}
                lastCapturePreviewUrl={lastSessionCapture?.previewUrl ?? null}
                onSaveLastAgain={onSaveLastCaptureAgain}
              />
            </>
          )}

          {cameraState.status !== 'ready' && (
            <CameraLaunch
              cameraState={cameraState}
              onRequestCamera={requestCamera}
            />
          )}
        </div>
      </div>

      {isMdUp && galleryVisible ? (
        <PoseGallery
          variant="desktop-sidebar"
          {...galleryPanelProps}
          layout="vertical"
        />
      ) : null}

      {!isMdUp && galleryVisible ? (
        <>
          <PoseGallery
            variant="mobile-sheet"
            open={mobileGalleryOpen}
            onOpenChange={setMobileGalleryOpen}
            {...galleryPanelProps}
            layout="horizontal"
          />
          <Button
            type="button"
            size="lg"
            className="fixed bottom-[calc(108px+env(safe-area-inset-bottom,0px))] left-1/2 z-40 h-12 -translate-x-1/2 rounded-full border-cam-hairline bg-cam-panel/95 px-6 font-black text-cam-ink shadow-cam-panel backdrop-blur-md"
            onClick={() => setMobileGalleryOpen(true)}
          >
            <Images className="mr-2 size-5" />
            Poses
          </Button>
        </>
      ) : null}
    </div>
  )
}
