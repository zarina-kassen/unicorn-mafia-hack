import { useEffect, useRef } from 'react'

import type { NormalizedLandmark } from '../pose/mediapipe'
import { LM } from '../pose/mediapipe'
import type { PoseTemplate } from '../pose/templates'

interface PoseOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  targetTemplate: PoseTemplate
  /** Mirror drawing horizontally to match a mirrored selfie video feed. */
  mirrored?: boolean
  /** Pause drawing without tearing down the canvas. */
  paused?: boolean
}

interface Point {
  x: number
  y: number
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function averageX(points: Array<Point | null>, fallback: number): number {
  const visible = points.filter((point): point is Point => point !== null)
  if (visible.length === 0) return fallback
  return visible.reduce((sum, point) => sum + point.x, 0) / visible.length
}

function spreadFromCenter(
  point: Point | null,
  centerX: number,
  factor: number,
): Point | null {
  if (!point) return null
  return { x: centerX + (point.x - centerX) * factor, y: point.y }
}

function projectLandmark(
  landmarks: NormalizedLandmark[],
  index: number,
  width: number,
  height: number,
  mirrored: boolean,
): Point | null {
  const lm = landmarks[index]
  if (!lm || (lm.visibility ?? 0) < 0.2) return null
  const x = mirrored ? (1 - lm.x) * width : lm.x * width
  return { x, y: lm.y * height }
}

function wobble(point: Point, index: number, amplitude: number, phase: number): Point {
  const wave = index * 1.618 + phase
  return {
    x: point.x + Math.sin(wave) * amplitude,
    y: point.y + Math.cos(wave * 1.37) * amplitude,
  }
}

function drawLooseStroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  {
    width,
    alpha,
    phase,
  }: {
    width: number
    alpha: number
    phase: number
  },
) {
  if (points.length < 2) return

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = '#fffef7'
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(255, 255, 255, 0.7)'
  ctx.shadowBlur = width * 0.75

  const jitter = Math.max(1.2, width * 0.18)
  const first = wobble(points[0], 0, jitter, phase)
  ctx.beginPath()
  ctx.moveTo(first.x, first.y)

  for (let i = 1; i < points.length - 1; i += 1) {
    const current = wobble(points[i], i, jitter, phase)
    const next = wobble(points[i + 1], i + 1, jitter, phase)
    const control = midpoint(current, next)
    ctx.quadraticCurveTo(current.x, current.y, control.x, control.y)
  }

  const last = wobble(points[points.length - 1], points.length - 1, jitter, phase)
  ctx.lineTo(last.x, last.y)
  ctx.stroke()
  ctx.restore()
}

function drawHandDrawnPath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  lineWidth: number,
  phase: number,
) {
  drawLooseStroke(ctx, points, { width: lineWidth + 2, alpha: 0.28, phase })
  drawLooseStroke(ctx, points, { width: lineWidth, alpha: 0.96, phase: phase + 2.1 })
  drawLooseStroke(ctx, points, {
    width: Math.max(2, lineWidth * 0.52),
    alpha: 0.48,
    phase: phase + 4.8,
  })
}

function drawLooseEllipse(
  ctx: CanvasRenderingContext2D,
  center: Point,
  rx: number,
  ry: number,
  lineWidth: number,
  phase: number,
) {
  const points: Point[] = []
  const steps = 46
  for (let i = 0; i <= steps; i += 1) {
    const t = (Math.PI * 2 * i) / steps
    const uneven = 1 + Math.sin(t * 3 + phase) * 0.035 + Math.cos(t * 5) * 0.025
    points.push({
      x: center.x + Math.cos(t) * rx * uneven,
      y: center.y + Math.sin(t) * ry * uneven,
    })
  }
  drawHandDrawnPath(ctx, points, lineWidth, phase)
}

function compact(points: Array<Point | null>): Point[] {
  return points.filter((point): point is Point => point !== null)
}

function drawHuaweiGuide(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  mirrored: boolean,
) {
  const p = (index: number) => projectLandmark(landmarks, index, width, height, mirrored)
  const nose = p(LM.NOSE)
  const leftShoulder = p(LM.L_SHOULDER)
  const rightShoulder = p(LM.R_SHOULDER)
  const leftElbow = p(LM.L_ELBOW)
  const rightElbow = p(LM.R_ELBOW)
  const leftWrist = p(LM.L_WRIST)
  const rightWrist = p(LM.R_WRIST)
  const leftHip = p(LM.L_HIP)
  const rightHip = p(LM.R_HIP)
  const leftKnee = p(LM.L_KNEE)
  const rightKnee = p(LM.R_KNEE)
  const leftAnkle = p(LM.L_ANKLE)
  const rightAnkle = p(LM.R_ANKLE)

  const centerX = averageX(
    [leftShoulder, rightShoulder, leftHip, rightHip],
    width / 2,
  )
  const wideShoulders = [
    spreadFromCenter(leftShoulder, centerX, 1.72),
    spreadFromCenter(rightShoulder, centerX, 1.72),
  ] as const
  const shoulderWidth =
    wideShoulders[0] && wideShoulders[1]
      ? distance(wideShoulders[0], wideShoulders[1])
      : width * 0.2
  const lineWidth = Math.max(7, Math.min(22, width * 0.018))
  const phase = 0.35

  if (nose) {
    drawLooseEllipse(
      ctx,
      { x: nose.x, y: nose.y + shoulderWidth * 0.12 },
      shoulderWidth * 0.58,
      shoulderWidth * 0.72,
      lineWidth,
      phase,
    )
  }

  const outerContour = compact([
    spreadFromCenter(leftWrist, centerX, 1.95),
    spreadFromCenter(leftElbow, centerX, 1.9),
    spreadFromCenter(leftShoulder, centerX, 1.72),
    spreadFromCenter(leftHip, centerX, 1.42),
    spreadFromCenter(leftKnee, centerX, 1.48),
    spreadFromCenter(leftAnkle, centerX, 1.36),
    spreadFromCenter(rightAnkle, centerX, 1.36),
    spreadFromCenter(rightKnee, centerX, 1.48),
    spreadFromCenter(rightHip, centerX, 1.42),
    spreadFromCenter(rightShoulder, centerX, 1.72),
    spreadFromCenter(rightElbow, centerX, 1.9),
    spreadFromCenter(rightWrist, centerX, 1.95),
  ])
  drawHandDrawnPath(ctx, outerContour, lineWidth, phase + 1.2)
}

/**
 * Renders the selected pose as a loose, Huawei-like white guide. It avoids
 * live skeleton/debug landmarks so the camera view stays photo-native.
 */
export function PoseOverlay({
  videoRef,
  targetTemplate,
  mirrored = true,
  paused = false,
}: PoseOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const templateRef = useRef<PoseTemplate>(targetTemplate)

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
          drawHuaweiGuide(
            ctx,
            templateRef.current.landmarks,
            canvas.width,
            canvas.height,
            mirrored,
          )
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

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none mix-blend-screen" />
}
