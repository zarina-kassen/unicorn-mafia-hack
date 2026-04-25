import { useEffect, useRef } from 'react'

import type { NormalizedLandmark } from '../pose/mediapipe'
import { POSE_CONNECTIONS } from '../pose/mediapipe'
import type { PoseTemplate } from '../pose/templates'

interface PoseOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  liveLandmarks: NormalizedLandmark[] | null
  targetTemplate: PoseTemplate
  /** Mirror drawing horizontally to match a mirrored selfie video feed. */
  mirrored?: boolean
  /** Pause drawing without tearing down the canvas. */
  paused?: boolean
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  {
    stroke,
    jointColor,
    lineWidth,
    jointRadius,
    alpha,
    mirrored,
  }: {
    stroke: string
    jointColor: string
    lineWidth: number
    jointRadius: number
    alpha: number
    mirrored: boolean
  },
) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = stroke
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const project = (lm: NormalizedLandmark) => {
    const x = mirrored ? (1 - lm.x) * width : lm.x * width
    const y = lm.y * height
    return [x, y] as const
  }

  for (const [a, b] of POSE_CONNECTIONS) {
    const la = landmarks[a]
    const lb = landmarks[b]
    if (!la || !lb) continue
    if ((la.visibility ?? 0) < 0.3 || (lb.visibility ?? 0) < 0.3) continue
    const [ax, ay] = project(la)
    const [bx, by] = project(lb)
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
  }

  ctx.fillStyle = jointColor
  for (const lm of landmarks) {
    if ((lm.visibility ?? 0) < 0.3) continue
    const [x, y] = project(lm)
    ctx.beginPath()
    ctx.arc(x, y, jointRadius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * Draws the target template skeleton (as a thick, soft "outline") plus the
 * live user skeleton on top. The component runs its own rAF loop so drawing
 * is independent of React re-render cadence.
 */
export function PoseOverlay({
  videoRef,
  liveLandmarks,
  targetTemplate,
  mirrored = true,
  paused = false,
}: PoseOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<NormalizedLandmark[] | null>(null)
  const templateRef = useRef<PoseTemplate>(targetTemplate)

  useEffect(() => {
    liveRef.current = liveLandmarks
  }, [liveLandmarks])
  useEffect(() => {
    templateRef.current = targetTemplate
  }, [targetTemplate])

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    let rafId = 0
    let cancelled = false

    const resize = () => {
      const rect = video.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
    }
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(video)

    const draw = () => {
      if (cancelled) return
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (!paused) {
          // Target outline (template)
          drawSkeleton(ctx, templateRef.current.landmarks, canvas.width, canvas.height, {
            stroke: '#7dd3fc',
            jointColor: '#7dd3fc',
            lineWidth: 12,
            jointRadius: 8,
            alpha: 0.55,
            mirrored,
          })
          // Live user skeleton
          if (liveRef.current) {
            drawSkeleton(ctx, liveRef.current, canvas.width, canvas.height, {
              stroke: '#facc15',
              jointColor: '#fef3c7',
              lineWidth: 4,
              jointRadius: 5,
              alpha: 0.95,
              mirrored,
            })
          }
        }
      }
      rafId = requestAnimationFrame(draw)
    }
    rafId = requestAnimationFrame(draw)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      ro.disconnect()
    }
  }, [videoRef, mirrored, paused])

  return <canvas ref={canvasRef} className="pose-overlay" />
}
