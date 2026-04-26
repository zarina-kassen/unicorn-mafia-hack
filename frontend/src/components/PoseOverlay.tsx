import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type Ref,
} from 'react'
import type { PoseOutlineResponse } from '../api/poseVariants'
import {
  type PreparedMask,
  buildPreparedMaskFromImageSource,
} from '../pose/preparedMaskFromImage'

interface PoseOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** Vision-LLM silhouette polygon (fallback until mask guide is ready). */
  outline?: PoseOutlineResponse | null
  /** Absolute URL of LLM mask image (white person on dark background). */
  photoMaskUrl?: string | null
  paused?: boolean
}

interface NormPoint {
  x: number
  y: number
}

interface PreparedOutline {
  outlineNorm: NormPoint[]
  bbox: { x: number; y: number; width: number; height: number }
}

interface Point {
  x: number
  y: number
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function traceSmoothClosedContour(ctx: CanvasRenderingContext2D, points: Point[]): void {
  const n = points.length
  if (n < 3) return
  const m0 = midpoint(points[n - 1], points[0])
  ctx.moveTo(m0.x, m0.y)
  for (let i = 0; i < n; i += 1) {
    const p = points[i]
    const next = points[(i + 1) % n]
    const m = midpoint(p, next)
    ctx.quadraticCurveTo(p.x, p.y, m.x, m.y)
  }
  ctx.closePath()
}

function prepareOutline(outline: PoseOutlineResponse): PreparedOutline | null {
  const poly = outline.polygon
  if (poly.length < 3) return null

  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  for (const p of poly) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const bw = Math.max(1e-6, maxX - minX)
  const bh = Math.max(1e-6, maxY - minY)
  if (bw < 0.02 || bh < 0.02) return null

  const outlineNorm: NormPoint[] = poly.map((p) => ({
    x: (p.x - minX) / bw,
    y: (p.y - minY) / bh,
  }))

  return {
    outlineNorm,
    bbox: { x: minX, y: minY, width: bw, height: bh },
  }
}

function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  outlineNorm: NormPoint[],
  bbox: { width: number; height: number },
  width: number,
  height: number,
  dpr: number,
): void {
  if (outlineNorm.length < 3) return

  const targetHeight = height * 0.82
  const scale = Math.max(0.1, targetHeight / bbox.height)
  const drawW = bbox.width * scale
  const drawH = bbox.height * scale
  const dx = (width - drawW) / 2
  const dy = height - drawH - height * 0.06

  const glow = Math.max(8, 14 * dpr)
  const lineWidth = Math.max(2.0, Math.min(4.2, width / dpr * 0.0045)) * dpr

  const projected: Point[] = outlineNorm.map((p) => ({
    x: dx + p.x * drawW,
    y: dy + p.y * drawH,
  }))

  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  ctx.beginPath()
  traceSmoothClosedContour(ctx, projected)
  ctx.filter = `blur(${glow}px)`
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.26)'
  ctx.lineWidth = lineWidth * 1.8
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()

  ctx.beginPath()
  traceSmoothClosedContour(ctx, projected)
  ctx.filter = 'none'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.98)'
  ctx.lineWidth = lineWidth
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
  ctx.restore()
}

function assignCanvasRef(
  node: HTMLCanvasElement | null,
  inner: MutableRefObject<HTMLCanvasElement | null>,
  outer: Ref<HTMLCanvasElement> | undefined,
): void {
  inner.current = node
  if (outer == null) return
  if (typeof outer === 'function') outer(node)
  else (outer as MutableRefObject<HTMLCanvasElement | null>).current = node
}

function preparedMaskToDraw(mask: PreparedMask): PreparedOutline | null {
  const { bbox, outlineNorm } = mask
  if (!bbox || !outlineNorm || outlineNorm.length < 3) return null
  return { outlineNorm, bbox }
}

export const PoseOverlay = forwardRef<HTMLCanvasElement, PoseOverlayProps>(function PoseOverlay(
  { videoRef, outline = null, photoMaskUrl = null, paused = false },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const setCanvasRef = useCallback(
    (node: HTMLCanvasElement | null) => assignCanvasRef(node, canvasRef, ref),
    [ref],
  )
  const outlinePreparedRef = useRef<PreparedOutline | null>(null)
  const maskPreparedRef = useRef<PreparedOutline | null>(null)

  useEffect(() => {
    outlinePreparedRef.current = outline ? prepareOutline(outline) : null
  }, [outline])

  useEffect(() => {
    maskPreparedRef.current = null
    if (!photoMaskUrl) return
    let cancelled = false
    void (async () => {
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('Mask image failed to load'))
          img.src = photoMaskUrl
        })
        if (cancelled) return
        const w = image.naturalWidth || image.width || 1
        const h = image.naturalHeight || image.height || 1
        const prepared = buildPreparedMaskFromImageSource(image, w, h)
        maskPreparedRef.current = preparedMaskToDraw(prepared)
      } catch {
        if (!cancelled) maskPreparedRef.current = null
      }
    })()
    return () => {
      cancelled = true
    }
  }, [photoMaskUrl])

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
        const dpr = window.devicePixelRatio || 1
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (!paused) {
          const fromMask = maskPreparedRef.current
          const fromOutline = outlinePreparedRef.current
          const prepared = fromMask ?? fromOutline
          if (prepared) {
            drawSilhouette(
              ctx,
              prepared.outlineNorm,
              prepared.bbox,
              canvas.width,
              canvas.height,
              dpr,
            )
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
  }, [videoRef, paused])

  return <canvas ref={setCanvasRef} className="pointer-events-none absolute inset-0" />
})
