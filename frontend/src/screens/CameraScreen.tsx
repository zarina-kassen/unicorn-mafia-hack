import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'

import {
  compositeMirroredVideoWithOverlay,
  makeCaptureFilename,
  tryShareOrDownload,
} from '@/hooks/saveAlignedComposite'
import { useCamera } from '@/hooks/useCamera'
import { usePoseVariants } from '@/hooks/usePoseVariants'
import { CameraFrame } from '@/components/CameraFrame'
import { CameraLaunch } from '@/components/CameraLaunch'
import { CameraTopBar } from '@/components/CameraTopBar'
import { PoseGallery } from '@/components/PoseGallery'
import { PoseOverlay } from '@/components/PoseOverlay'
import { ShutterDock } from '@/components/ShutterDock'

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

  const [galleryOpen, setGalleryOpen] = useState(false)
  const [shutterFlashActive, setShutterFlashActive] = useState(false)
  const [generateFlashActive, setGenerateFlashActive] = useState(false)
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
  const maskUrlForSelected =
    selectedPose !== null ? poseVariants.maskUrls[selectedPose.id] : null
  const outlineReadyForSelected =
    selectedPose !== null &&
    Boolean(
      outlineForSelected?.polygon && outlineForSelected.polygon.length >= 3,
    )
  const maskReadyForSelected = Boolean(maskUrlForSelected)
  const guideReadyForSelected = maskReadyForSelected || outlineReadyForSelected

  const canTakePicture =
    cameraState.status === 'ready' && !galleryBusy && guideReadyForSelected

  const lastSessionCapture = sessionCaptures[0] ?? null

  const handleGenerate = useCallback(() => {
    if (cameraState.status !== 'ready' || !videoRef.current || galleryBusy)
      return
    if (
      typeof window !== 'undefined' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setGenerateFlashActive(true)
    }
    setSelectedId(null)
    setGalleryOpen(true)
    poseVariants.mutate(videoRef.current)
  }, [cameraState.status, galleryBusy, poseVariants])

  const handleSelectPose = useCallback((id: string) => {
    setSelectedId(id)
    setGalleryOpen(false)
  }, [])

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

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <CameraFrame
        videoRef={videoRef}
        shutterFlashActive={shutterFlashActive}
        onShutterFlashEnd={() => setShutterFlashActive(false)}
        generateFlashActive={generateFlashActive}
        onGenerateFlashEnd={() => setGenerateFlashActive(false)}
        overlay={
          cameraState.status === 'ready' && selectedPose ? (
            <PoseOverlay
              ref={poseOverlayCanvasRef}
              key={selectedPose.id}
              videoRef={videoRef}
              outline={outlines[selectedPose.id] ?? null}
              photoMaskUrl={poseVariants.maskUrls[selectedPose.id] ?? null}
            />
          ) : null
        }
      />

      {cameraState.status === 'ready' && (
        <>
          <CameraTopBar
            className="absolute left-3 right-3 top-[max(12px,env(safe-area-inset-top,0px))] z-20 md:left-4 md:right-4 md:top-4"
            generationLabel={generationCopy}
            galleryBusy={galleryBusy}
            onGenerate={handleGenerate}
            onPrevPose={onPrevPose}
            onNextPose={onNextPose}
            onClearSelection={onClearSelection}
            poseCount={poses.length}
          />

          <ShutterDock
            canTakePicture={canTakePicture}
            onShutter={onShutterClick}
            lastCapturePreviewUrl={lastSessionCapture?.previewUrl ?? null}
            onSaveLastAgain={onSaveLastCaptureAgain}
            onOpenGallery={() => setGalleryOpen(true)}
          />
        </>
      )}

      {cameraState.status !== 'ready' && (
        <CameraLaunch
          cameraState={cameraState}
          onRequestCamera={requestCamera}
        />
      )}

      {galleryVisible ? (
        <PoseGallery
          open={galleryOpen}
          onOpenChange={setGalleryOpen}
          {...galleryPanelProps}
        />
      ) : null}
    </div>
  )
}
