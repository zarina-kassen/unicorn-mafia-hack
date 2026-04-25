export interface NormPoint {
  x: number
  y: number
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function polygonArea(ring: ReadonlyArray<readonly [number, number]>): number {
  let sum = 0
  const n = ring.length
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n
    sum += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]
  }
  return Math.abs(sum / 2)
}

function perpendicularDistance(p: NormPoint, a: NormPoint, b: NormPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
  const nx = a.x + t * dx
  const ny = a.y + t * dy
  return Math.hypot(p.x - nx, p.y - ny)
}

/** Ramer–Douglas–Peucker in normalized coordinates. */
export function simplifyClosedPath(points: NormPoint[], epsilon: number): NormPoint[] {
  if (points.length < 4) return points
  const open = points.slice(0, -1)
  const simplified = rdpLine(open, epsilon)
  if (simplified.length < 3) return points
  return [...simplified, simplified[0]]
}

function rdpLine(points: NormPoint[], epsilon: number): NormPoint[] {
  if (points.length <= 2) return points.slice()
  let idx = 0
  let maxD = 0
  const first = points[0]
  const last = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpendicularDistance(points[i], first, last)
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD > epsilon) {
    const left = rdpLine(points.slice(0, idx + 1), epsilon)
    const right = rdpLine(points.slice(idx), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [first, last]
}

function gaussianBlur3x3(values: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(values.length)
  const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let weighted = 0
      let total = 0
      for (let ky = -1; ky <= 1; ky += 1) {
        const sy = Math.max(0, Math.min(height - 1, y + ky))
        for (let kx = -1; kx <= 1; kx += 1) {
          const sx = Math.max(0, Math.min(width - 1, x + kx))
          const w = kernel[(ky + 1) * 3 + (kx + 1)]
          weighted += values[sy * width + sx] * w
          total += w
        }
      }
      out[y * width + x] = total > 0 ? weighted / total : 0
    }
  }
  return out
}

function keepLargestConnectedComponent(
  source: Float32Array,
  width: number,
  height: number,
  threshold: number,
): Float32Array {
  const n = width * height
  const labels = new Int32Array(n)
  const counts: number[] = [0]
  let label = 0
  const queueX = new Int32Array(n)
  const queueY = new Int32Array(n)
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x
      if (labels[idx] !== 0 || source[idx] < threshold) continue
      label += 1
      counts[label] = 0
      let qh = 0
      let qt = 0
      queueX[qt] = x
      queueY[qt] = y
      qt += 1
      labels[idx] = label
      while (qh < qt) {
        const cx = queueX[qh]
        const cy = queueY[qh]
        qh += 1
        counts[label] += 1
        for (const [dx, dy] of neighbors) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const nIdx = ny * width + nx
          if (labels[nIdx] !== 0 || source[nIdx] < threshold) continue
          labels[nIdx] = label
          queueX[qt] = nx
          queueY[qt] = ny
          qt += 1
        }
      }
    }
  }

  if (label === 0) return source
  let bestLabel = 1
  let bestCount = counts[1] ?? 0
  for (let i = 2; i <= label; i += 1) {
    if ((counts[i] ?? 0) > bestCount) {
      bestLabel = i
      bestCount = counts[i]
    }
  }

  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    if (labels[i] === bestLabel) out[i] = source[i]
  }
  return out
}

function estimatePerimeter(points: NormPoint[]): number {
  if (points.length < 2) return 0
  let sum = 0
  for (let i = 1; i < points.length; i += 1) {
    sum += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return sum
}

function resampleClosedPath(points: NormPoint[], step: number): NormPoint[] {
  if (points.length < 4 || step <= 0) return points
  const perimeter = estimatePerimeter(points)
  if (perimeter <= step * 2) return points
  const targetCount = Math.max(32, Math.min(320, Math.round(perimeter / step)))
  const result: NormPoint[] = [points[0]]
  let segIndex = 1
  let segStart = points[0]
  let segEnd = points[1]
  let segLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y)
  let distOnSeg = 0
  const interval = perimeter / targetCount

  for (let i = 1; i < targetCount; i += 1) {
    let needed = interval
    while (needed > 0 && segIndex < points.length) {
      const remain = segLen - distOnSeg
      if (needed <= remain && segLen > 0) {
        distOnSeg += needed
        const t = distOnSeg / segLen
        result.push({
          x: segStart.x + (segEnd.x - segStart.x) * t,
          y: segStart.y + (segEnd.y - segStart.y) * t,
        })
        needed = 0
      } else {
        needed -= Math.max(0, remain)
        segIndex += 1
        if (segIndex >= points.length) break
        segStart = points[segIndex - 1]
        segEnd = points[segIndex]
        segLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y)
        distOnSeg = 0
      }
    }
  }

  result.push({ x: result[0].x, y: result[0].y })
  return result
}

function smoothClosedPath(points: NormPoint[], passes: number): NormPoint[] {
  if (points.length < 5 || passes <= 0) return points
  let current = points.slice(0, -1)
  for (let pass = 0; pass < passes; pass += 1) {
    const next: NormPoint[] = []
    const n = current.length
    for (let i = 0; i < n; i += 1) {
      const a = current[(i - 1 + n) % n]
      const b = current[i]
      const c = current[(i + 1) % n]
      next.push({
        x: (a.x + b.x * 2 + c.x) / 4,
        y: (a.y + b.y * 2 + c.y) / 4,
      })
    }
    current = next
  }
  current.push({ x: current[0].x, y: current[0].y })
  return current
}

/**
 * Pure-JS marching squares at threshold 0.5.
 * Returns all rings (closed contours) in pixel coordinates.
 */
function marchingSquares(
  grid: Float32Array,
  width: number,
  height: number,
  threshold: number,
): Array<Array<[number, number]>> {
  // Edge tables for marching squares (16 cases)
  // Each entry: list of [x,y] fractional edge midpoints per cell
  // We trace contour segments cell by cell, then stitch into rings.

  type Seg = [[number, number], [number, number]]
  const segments: Seg[] = []

  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0
    return grid[y * width + x]
  }

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const tl = at(x, y) >= threshold ? 1 : 0
      const tr = at(x + 1, y) >= threshold ? 1 : 0
      const br = at(x + 1, y + 1) >= threshold ? 1 : 0
      const bl = at(x, y + 1) >= threshold ? 1 : 0
      const idx = (tl << 3) | (tr << 2) | (br << 1) | bl

      // Edge midpoints (fractional pixel coords)
      const top: [number, number] = [x + 0.5, y]
      const right: [number, number] = [x + 1, y + 0.5]
      const bottom: [number, number] = [x + 0.5, y + 1]
      const left: [number, number] = [x, y + 0.5]

      switch (idx) {
        case 1:  segments.push([bottom, left]); break
        case 2:  segments.push([right, bottom]); break
        case 3:  segments.push([right, left]); break
        case 4:  segments.push([top, right]); break
        case 5:  segments.push([top, right]); segments.push([bottom, left]); break
        case 6:  segments.push([top, bottom]); break
        case 7:  segments.push([top, left]); break
        case 8:  segments.push([left, top]); break
        case 9:  segments.push([bottom, top]); break
        case 10: segments.push([left, bottom]); segments.push([top, right]); break
        case 11: segments.push([right, top]); break  // fixed: was [bottom, top] duplicate
        case 12: segments.push([left, right]); break
        case 13: segments.push([bottom, right]); break
        case 14: segments.push([left, bottom]); break
        default: break // 0 and 15: no contour
      }
    }
  }

  if (segments.length === 0) return []

  // Stitch segments into rings using a point map
  // Key: "x,y" rounded to 1 decimal
  const key = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`

  // Build adjacency: each endpoint maps to segments that touch it
  const adj = new Map<string, Array<{ seg: Seg; used: boolean }>>()
  const segObjs = segments.map((seg) => ({ seg, used: false }))

  for (const obj of segObjs) {
    const k0 = key(obj.seg[0])
    const k1 = key(obj.seg[1])
    if (!adj.has(k0)) adj.set(k0, [])
    if (!adj.has(k1)) adj.set(k1, [])
    adj.get(k0)!.push(obj)
    adj.get(k1)!.push(obj)
  }

  const rings: Array<Array<[number, number]>> = []

  for (const startObj of segObjs) {
    if (startObj.used) continue
    startObj.used = true
    const ring: Array<[number, number]> = [startObj.seg[0], startObj.seg[1]]
    let current = startObj.seg[1]

    for (;;) {
      const neighbors = adj.get(key(current)) ?? []
      const next = neighbors.find((o) => !o.used)
      if (!next) break
      next.used = true
      const other = key(next.seg[0]) === key(current) ? next.seg[1] : next.seg[0]
      if (key(other) === key(ring[0])) {
        ring.push(ring[0])
        break
      }
      ring.push(other)
      current = other
    }

    if (ring.length >= 4) rings.push(ring)
  }

  return rings
}

/**
 * Outer silhouette of a person mask: pure-JS marching squares at 0.5,
 * largest exterior ring, normalized to [0,1] × [0,1].
 */
export function outlineFromPersonMaskGrid(
  values: Float32Array,
  width: number,
  height: number,
): NormPoint[] | null {
  if (width < 2 || height < 2 || values.length !== width * height) return null

  const blurred = gaussianBlur3x3(values, width, height)
  const refined = keepLargestConnectedComponent(blurred, width, height, 0.38)

  const rings = marchingSquares(refined, width, height, 0.5)
  if (rings.length === 0) return null

  // Pick ring with largest area
  let best: Array<[number, number]> | null = null
  let bestArea = 0
  for (const ring of rings) {
    const a = polygonArea(ring)
    if (a > bestArea) {
      bestArea = a
      best = ring
    }
  }
  if (!best || bestArea < width * height * 0.0005) return null

  const norm: NormPoint[] = best.map(([px, py]) => ({
    x: clamp01(px / width),
    y: clamp01(py / height),
  }))

  if (norm.length > 0) {
    const first = norm[0]
    const last = norm[norm.length - 1]
    if (first.x !== last.x || first.y !== last.y) norm.push({ x: first.x, y: first.y })
  }

  const eps = Math.max(0.0006, Math.min(0.0022, 0.8 / Math.min(width, height)))
  const simplified = simplifyClosedPath(norm, eps)
  const resampled = resampleClosedPath(simplified, 1.25 / Math.min(width, height))
  return smoothClosedPath(resampled, 1)
}
