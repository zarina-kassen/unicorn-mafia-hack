import { type NormPoint, outlineFromPersonMaskGrid } from './maskToOutline'

export interface PreparedMask {
  bbox: { x: number; y: number; width: number; height: number } | null
  outlineNorm: NormPoint[] | null
}

/**
 * Rasterize an LLM mask image (white person on dark / transparent background) and
 * extract a smooth closed contour (branch-5 pipeline).
 */
export function buildPreparedMaskFromImageSource(
  image: CanvasImageSource,
  width: number,
  height: number,
): PreparedMask {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(width))
  canvas.height = Math.max(1, Math.floor(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return { bbox: null, outlineNorm: null }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = img.data

  const w = canvas.width
  const h = canvas.height
  const n = w * h
  const keep = new Uint8Array(n)
  const alphaCoverage = (() => {
    let visible = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 16) visible += 1
    return visible / n
  })()

  if (alphaCoverage > 0.02 && alphaCoverage < 0.98) {
    for (let idx = 0; idx < n; idx += 1) {
      const i = idx * 4
      keep[idx] = data[i + 3] > 16 ? 1 : 0
    }
  } else {
    let cornerSum = 0
    let cornerSq = 0
    let cornerN = 0
    const sampleRadius = Math.max(6, Math.floor(Math.min(w, h) * 0.02))
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const isCorner =
          (x < sampleRadius && y < sampleRadius) ||
          (x >= w - sampleRadius && y < sampleRadius) ||
          (x < sampleRadius && y >= h - sampleRadius) ||
          (x >= w - sampleRadius && y >= h - sampleRadius)
        if (!isCorner) continue
        const i = (y * w + x) * 4
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        cornerSum += lum
        cornerSq += lum * lum
        cornerN += 1
      }
    }
    const mean = cornerN > 0 ? cornerSum / cornerN : 200
    const variance = cornerN > 0 ? Math.max(0, cornerSq / cornerN - mean * mean) : 100
    const std = Math.sqrt(variance)
    const threshold = Math.min(250, Math.max(210, mean + std * 1.8))

    for (let idx = 0; idx < n; idx += 1) {
      const i = idx * 4
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      keep[idx] = lum >= threshold ? 1 : 0
    }
  }

  const q = new Int32Array(n)
  const visited = new Uint8Array(n)
  let bestCount = 0
  let bestIndices: Int32Array | null = null
  for (let seed = 0; seed < n; seed += 1) {
    if (!keep[seed] || visited[seed]) continue
    let qh = 0
    let qt = 0
    q[qt++] = seed
    visited[seed] = 1
    while (qh < qt) {
      const idx = q[qh++]
      const x = idx % w
      const y = (idx - x) / w
      const push = (nIdx: number) => {
        if (!keep[nIdx] || visited[nIdx]) return
        visited[nIdx] = 1
        q[qt++] = nIdx
      }
      if (x > 0) push(idx - 1)
      if (x + 1 < w) push(idx + 1)
      if (y > 0) push(idx - w)
      if (y + 1 < h) push(idx + w)
    }
    if (qt > bestCount) {
      bestCount = qt
      bestIndices = q.slice(0, qt)
    }
  }

  keep.fill(0)
  if (bestIndices) {
    for (let i = 0; i < bestIndices.length; i += 1) keep[bestIndices[i]] = 1
  }

  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1

  for (let idx = 0; idx < n; idx += 1) {
    const i = idx * 4
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    const isFg = keep[idx] === 1
    data[i + 3] = isFg ? 255 : 0
    if (isFg) {
      const x = idx % w
      const y = (idx - x) / w
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  ctx.putImageData(img, 0, 0)
  const bbox =
    maxX >= minX && maxY >= minY
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : null
  let outlineNorm: NormPoint[] | null = null
  if (bbox && bbox.width >= 3 && bbox.height >= 3) {
    const grid = new Float32Array(bbox.width * bbox.height)
    for (let y = 0; y < bbox.height; y += 1) {
      for (let x = 0; x < bbox.width; x += 1) {
        const srcIdx = (bbox.y + y) * w + (bbox.x + x)
        grid[y * bbox.width + x] = keep[srcIdx] ? 1 : 0
      }
    }
    outlineNorm = outlineFromPersonMaskGrid(grid, bbox.width, bbox.height)
  }
  return { bbox, outlineNorm }
}
