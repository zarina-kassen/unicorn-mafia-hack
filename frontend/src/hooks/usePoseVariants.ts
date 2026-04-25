import { useAuth } from '@clerk/react'
import { useMutation } from '@tanstack/react-query'
import { PoseVariantsClient, type PoseVariantResult } from '../api/poseVariants'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''

export interface GalleryPose {
  id: string
  title: string
  imageSrc: string
}

function assetUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  return `${BACKEND_URL}${path}`
}

function toGalleryPose(r: PoseVariantResult): GalleryPose {
  return { id: r.id, title: r.title, imageSrc: assetUrl(r.image_url) }
}

function captureFrame(video: HTMLVideoElement): Promise<Blob> {
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
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode camera frame.'))),
      'image/jpeg',
      0.92,
    )
  })
}

export function usePoseVariants() {
  const { getToken } = useAuth()
  const client = new PoseVariantsClient(getToken)

  return useMutation({
    mutationFn: async (videoEl: HTMLVideoElement) => {
      const frame = await captureFrame(videoEl)
      const results = await client.createJob(frame)
      return results.map(toGalleryPose)
    },
  })
}
