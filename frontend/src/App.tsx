import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAuth } from '@clerk/react'
import { Wallet } from 'lucide-react'

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
  ApiError,
  createPoseVariantJob,
  getBillingAccount,
  getLinkedInStatus,
  type BillingAccount,
  type LinkedInPipelineResult,
  type PoseVariantResult,
  publishLinkedInPost,
  runLinkedInPipeline,
  startLinkedInOAuth,
  subscribePoseVariantJob,
  uploadOnboardingGalleryImages,
} from './backend/client'
import {
  blobToBase64,
  loadAllPhotos,
  putPhoto,
  recordToBlob,
  trimToMax,
  type SavedPhotoRecord,
} from './camera/savedPhotosDb'
import { usePoseLandmarker } from './pose/usePoseLandmarker'
import { matchAgainstTemplate } from './pose/matcher'
import type { NormalizedLandmark } from './pose/mediapipe'
import { Button } from '@/components/ui/button'
import { WalletSheet } from './components/WalletSheet'
import './App.css'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''
const ONBOARDING_STORAGE_KEY = 'frame-mog-onboarding-gallery-v1'

/** Visible strip when the pose gallery sheet is collapsed (px). */
const GALLERY_SHEET_PEEK_PX = 80
const MAX_SESSION_SAVED_PHOTOS = 20
const DEFAULT_OCCASION = 'general'

type GenerationStatus = 'idle' | 'capturing' | 'generating' | 'ready' | 'failed'

interface SessionCapture {
  id: string
  blob: Blob
  previewUrl: string
  poseName: string
  matchConfidence: number
  occasionType: string
  capturedAt: string
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
  const { getToken, isSignedIn } = useAuth()
  const [walletOpen, setWalletOpen] = useState(false)
  const [billingAccount, setBillingAccount] = useState<BillingAccount | null>(null)
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
  const [linkedInBusy, setLinkedInBusy] = useState(false)
  const [linkedInPreview, setLinkedInPreview] = useState<LinkedInPipelineResult | null>(null)
  const [linkedInAsDraft, setLinkedInAsDraft] = useState(true)
  const [linkedInMessage, setLinkedInMessage] = useState<string | null>(null)
  const sessionCapturesRef = useRef<SessionCapture[]>([])
  const lastMatchRef = useRef({ score: 0, personVisible: true })
  const savedPhotosHydratedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const t = window.setTimeout(() => {
      const alreadyDone = window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'done'
      setOnboardingDone(alreadyDone)
    }, 0)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!onboardingDone || savedPhotosHydratedRef.current) return
    savedPhotosHydratedRef.current = true
    void (async () => {
      try {
        const rows = await loadAllPhotos()
        rows.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
        const next: SessionCapture[] = rows.map((r) => {
          const { blob } = recordToBlob(r)
          return {
            id: r.id,
            blob,
            previewUrl: URL.createObjectURL(blob),
            poseName: r.poseName,
            matchConfidence: r.matchConfidence,
            occasionType: r.occasionType,
            capturedAt: r.capturedAt,
          }
        })
        setSessionCaptures((prev) => {
          for (const c of prev) URL.revokeObjectURL(c.previewUrl)
          return next.slice(0, MAX_SESSION_SAVED_PHOTOS)
        })
      } catch {
        // IDB failed — keep in-memory only
      }
    })()
  }, [onboardingDone])

  const refreshBilling = useCallback(async () => {
    if (!isSignedIn) {
      setBillingAccount(null)
      return
    }
    try {
      const account = await getBillingAccount(BACKEND_URL, getToken)
      setBillingAccount(account)
    } catch {
      setBillingAccount(null)
    }
  }, [getToken, isSignedIn])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void refreshBilling()
    }, 0)
    return () => clearTimeout(t)
  }, [refreshBilling])

  useEffect(() => {
    if (generationStatus !== 'ready') return
    const t = window.setTimeout(() => {
      void refreshBilling()
    }, 0)
    return () => clearTimeout(t)
  }, [generationStatus, refreshBilling])

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

  const onLandmarks = useCallback(
    (lm: NormalizedLandmark[] | null) => {
      if (!lm || !selectedPose) return
      const m = matchAgainstTemplate(lm, selectedPose.template)
      lastMatchRef.current = m
    },
    [selectedPose],
  )

  const galleryBusy = generationStatus === 'capturing' || generationStatus === 'generating'
  const hasGeneratedGallery = generationStatus === 'ready'
  /** Outline only for the pose the user explicitly picked in the gallery. */
  const showPoseGuide = selectedPose !== null

  usePoseLandmarker(
    videoRef,
    cameraState.status === 'ready' && showPoseGuide,
    onLandmarks,
  )

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
      const t = window.setTimeout(() => {
        setGallerySheetY(0)
        galleryMaxYRef.current = 0
        setGallerySheetMaxY(0)
      }, 0)
      return () => clearTimeout(t)
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
      const job = await createPoseVariantJob(frame, BACKEND_URL, getToken)
      setGenerationJobId(job.job_id)
      setGenerationProgress({ current: job.progress, total: job.total })
      setGenerationStatus('generating')
      void refreshBilling()
    } catch (err) {
      setGalleryPoses([])
      outlineExtractionStartedRef.current.clear()
      setPhotoMaskById({})
      setMaskErrorById({})
      setSelectedPoseId(null)
      setGenerationJobId(null)
      setGenerationStatus('failed')
      if (err instanceof ApiError && err.status === 402) {
        setGenerationError(
          err.detail?.message ?? 'Not enough credits. Open the wallet to top up.',
        )
        void refreshBilling()
      } else {
        setGenerationError(err instanceof Error ? err.message : String(err))
      }
    }
  }, [cameraState.status, galleryBusy, getToken, refreshBilling])

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
      const selected = selectedPose
      const conf = lastMatchRef.current.score
      const capturedAt = new Date().toISOString()
      const itemId = crypto.randomUUID()
      const previewUrl = URL.createObjectURL(blob)
      const item: SessionCapture = {
        id: itemId,
        blob,
        previewUrl,
        poseName: selected?.title ?? 'Unknown',
        matchConfidence: conf,
        occasionType: DEFAULT_OCCASION,
        capturedAt,
      }
      setSessionCaptures((previous) => {
        const next = [item, ...previous].slice(0, MAX_SESSION_SAVED_PHOTOS)
        if (previous.length >= MAX_SESSION_SAVED_PHOTOS) {
          URL.revokeObjectURL(previous[MAX_SESSION_SAVED_PHOTOS - 1].previewUrl)
        }
        return next
      })
      void (async () => {
        try {
          const b64 = await blobToBase64(blob)
          const rec: SavedPhotoRecord = {
            id: itemId,
            imageBase64: b64,
            poseName: item.poseName,
            matchConfidence: item.matchConfidence,
            occasionType: item.occasionType,
            capturedAt: item.capturedAt,
          }
          await putPhoto(rec)
          await trimToMax(MAX_SESSION_SAVED_PHOTOS)
        } catch {
          // persistence best-effort
        }
      })()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save photo.'
      setCaptureError(message)
      window.setTimeout(() => setCaptureError(null), 4200)
    }
  }, [canTakePicture, selectedPose])

  const onSaveLastCaptureAgain = useCallback(() => {
    const capture = lastSessionCapture
    if (!capture) return
    void tryShareOrDownload(capture.blob, makeCaptureFilename())
  }, [lastSessionCapture])

  const onShutterFlashAnimationEnd = useCallback((event: React.AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    setShutterFlashActive(false)
  }, [])

  const onPostToLinkedin = useCallback(async () => {
    if (!isSignedIn || sessionCaptures.length === 0) return
    setLinkedInMessage(null)
    setLinkedInBusy(true)
    setLinkedInPreview(null)
    try {
      const st = await getLinkedInStatus(BACKEND_URL, getToken)
      if (!st.connected) {
        const start = await startLinkedInOAuth(BACKEND_URL, getToken)
        window.location.assign(start.authorization_url)
        return
      }
      const form = new FormData()
      const metas = sessionCaptures.map((c) => ({
        pose_name: c.poseName,
        confidence: c.matchConfidence,
        occasion_type: c.occasionType,
        captured_at: c.capturedAt,
        client_id: c.id,
      }))
      form.append('metas', JSON.stringify(metas))
      for (const c of sessionCaptures) {
        form.append('images', c.blob, `frame-${c.id}.jpg`)
      }
      const result = await runLinkedInPipeline(form, BACKEND_URL, getToken)
      setLinkedInPreview(result)
    } catch (e) {
      setLinkedInMessage(
        e instanceof Error ? e.message : 'Could not run LinkedIn pipeline.',
      )
    } finally {
      setLinkedInBusy(false)
    }
  }, [getToken, isSignedIn, sessionCaptures])

  const onLinkedInPublish = useCallback(async () => {
    if (!linkedInPreview) return
    setLinkedInMessage(null)
    setLinkedInBusy(true)
    try {
      const ids = linkedInPreview.sequence.map((s) => s.photo_id)
      await publishLinkedInPost(
        {
          ordered_photo_ids: ids,
          as_draft: linkedInAsDraft,
          sequence: linkedInPreview.sequence,
        },
        BACKEND_URL,
        getToken,
      )
      setLinkedInPreview(null)
      setLinkedInMessage('Post completed.')
    } catch (e) {
      setLinkedInMessage(
        e instanceof Error ? e.message : 'Could not publish to LinkedIn.',
      )
    } finally {
      setLinkedInBusy(false)
    }
  }, [getToken, linkedInAsDraft, linkedInPreview])

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
                <div className="camera-top-bar__wallet">
                  {isSignedIn && billingAccount !== null ? (
                    <span className="credit-pill" title="Credits balance">
                      {billingAccount.balance}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="wallet-icon-button"
                    aria-label="Credits and top up"
                    onClick={() => setWalletOpen(true)}
                  >
                    <Wallet className="size-5" aria-hidden />
                  </button>
                </div>
                <button
                  className="generate-button"
                  type="button"
                  onClick={() => void handleGeneratePoses()}
                  disabled={galleryBusy}
                >
                  {generationCopy}
                </button>
              </div>
              <WalletSheet
                open={walletOpen}
                onClose={() => setWalletOpen(false)}
                baseUrl={BACKEND_URL}
                getToken={getToken}
                onBalanceUpdated={() => void refreshBilling()}
              />

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
                <div className="camera-shutter-bar__right">
                  <button
                    type="button"
                    className="post-linkedin-btn"
                    disabled={
                      !isSignedIn || sessionCaptures.length === 0 || linkedInBusy
                    }
                    onClick={() => void onPostToLinkedin()}
                  >
                    {linkedInBusy ? '…' : 'Post to LinkedIn'}
                  </button>
                </div>
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
        {linkedInPreview ? (
          <div
            className="linkedin-confirm"
            role="dialog"
            aria-label="Review LinkedIn post order"
          >
            <div className="linkedin-confirm__panel">
              <h3>Review order</h3>
              <p className="linkedin-confirm__text">
                Confirm the sequence, then publish or save as draft.
              </p>
              <ol className="linkedin-confirm__list">
                {linkedInPreview.sequence.map((row) => {
                  const localId = row.client_id ?? null
                  const cap = localId
                    ? sessionCaptures.find((c) => c.id === localId)
                    : null
                  return (
                    <li key={row.photo_id}>
                      {cap ? (
                        <img src={cap.previewUrl} alt="" className="linkedin-confirm__thumb" />
                      ) : null}
                      <span>{row.reason}</span>
                    </li>
                  )
                })}
              </ol>
              <label className="linkedin-confirm__draft">
                <input
                  type="checkbox"
                  checked={linkedInAsDraft}
                  onChange={(e) => setLinkedInAsDraft(e.target.checked)}
                />
                Save as draft
              </label>
              <div className="linkedin-confirm__actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLinkedInPreview(null)}
                  disabled={linkedInBusy}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void onLinkedInPublish()}
                  disabled={linkedInBusy}
                >
                  {linkedInBusy ? 'Publishing…' : 'Confirm'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {linkedInMessage && !linkedInPreview ? (
          <p className="linkedin-toast" role="status">
            {linkedInMessage}
          </p>
        ) : null}
      </main>
    </div>
  )
}

export default App
