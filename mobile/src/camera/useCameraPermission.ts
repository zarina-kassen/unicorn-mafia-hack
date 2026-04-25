import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Camera,
  useCameraDevice,
  type CameraDevice,
} from 'react-native-vision-camera'

export type CameraStatus = 'idle' | 'granted' | 'denied' | 'unavailable'

/**
 * Camera permission state machine + front-camera device lookup.
 *
 * Same 4-state shape as the web hook so `CameraScreen` can switch over the
 * status identically: idle → granted | denied; granted → unavailable if no
 * front camera exists on the device.
 */
export function useCameraPermission(): {
  status: CameraStatus
  request: () => Promise<void>
  device: CameraDevice | null
} {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const device = useCameraDevice('front') ?? null

  // Keep status in sync with device availability once permission is granted.
  const effectiveStatus: CameraStatus = useMemo(() => {
    if (status === 'granted' && !device) return 'unavailable'
    return status
  }, [status, device])

  useEffect(() => {
    const current = Camera.getCameraPermissionStatus()
    if (current === 'granted') setStatus('granted')
    else if (current === 'denied' || current === 'restricted') setStatus('denied')
  }, [])

  const request = useCallback(async () => {
    const result = await Camera.requestCameraPermission()
    setStatus(result === 'granted' ? 'granted' : 'denied')
  }, [])

  return { status: effectiveStatus, request, device }
}
