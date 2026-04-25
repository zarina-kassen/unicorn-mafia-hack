import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@clerk/react'
import { MasksClient } from '../api/masks'
import type { GalleryPose } from './usePoseVariants'

export function usePoseMask(poses: GalleryPose[]) {
  const { getToken } = useAuth()
  const client = useMemo(() => new MasksClient(getToken), [getToken])
  const extractedIds = useRef(new Set<string>())
  const [maskUrls, setMaskUrls] = useState<Record<string, string>>({})
  const [maskErrors, setMaskErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    for (const pose of poses) {
      if (extractedIds.current.has(pose.id)) continue
      extractedIds.current.add(pose.id)
      void (async () => {
        try {
          const mask = await client.extract(pose.imageSrc)
          setMaskUrls(prev => ({ ...prev, [pose.id]: mask.mask_url }))
          setMaskErrors(prev => {
            const next = { ...prev }
            delete next[pose.id]
            return next
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'mask extraction failed'
          setMaskErrors(prev => ({ ...prev, [pose.id]: message }))
        }
      })()
    }
  }, [poses, client])

  return { maskUrls, maskErrors }
}