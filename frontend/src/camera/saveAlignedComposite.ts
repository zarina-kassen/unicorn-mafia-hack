/** Composites the live camera (mirrored like the preview) with the pose outline canvas. */

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2500)
}

export function makeCaptureFilename(): string {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  return `frame-mog-${stamp}.jpg`
}

/**
 * Draws the video frame into `targetW`×`targetH` using the same center-crop rule as
 * CSS `object-fit: cover` on the element, then mirrors horizontally to match the
 * mirrored `<video>` preview.
 */
function drawMirroredVideoCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  targetW: number,
  targetH: number,
): void {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (vw <= 0 || vh <= 0) return

  const videoAr = vw / vh
  const boxAr = targetW / targetH
  let sx: number
  let sy: number
  let sw: number
  let sh: number
  if (videoAr > boxAr) {
    sh = vh
    sw = Math.round(vh * boxAr)
    sx = Math.round((vw - sw) / 2)
    sy = 0
  } else {
    sw = vw
    sh = Math.round(vw / boxAr)
    sx = 0
    sy = Math.round((vh - sh) / 2)
  }

  ctx.save()
  ctx.translate(targetW, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetW, targetH)
  ctx.restore()
}

export async function compositeMirroredVideoWithOverlay(
  video: HTMLVideoElement,
  overlayCanvas: HTMLCanvasElement,
): Promise<Blob> {
  const w = overlayCanvas.width
  const h = overlayCanvas.height
  if (w < 1 || h < 1) {
    return Promise.reject(new Error('Overlay is not ready yet.'))
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Could not create export canvas.'))

  drawMirroredVideoCover(ctx, video, w, h)
  ctx.drawImage(overlayCanvas, 0, 0, w, h)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Could not encode composite image.'))
      },
      'image/jpeg',
      0.92,
    )
  })
}

export async function tryShareOrDownload(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'image/jpeg' })
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename })
        return
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (err instanceof Error && err.name === 'AbortError') return
    }
  }
  triggerBlobDownload(blob, filename)
}
