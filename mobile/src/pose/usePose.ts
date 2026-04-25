import { useCallback, useRef } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import {
  Delegate,
  RunningMode,
  usePoseDetection,
  type PoseDetectionResultBundle,
  type DetectionError,
  type Landmark as MpLandmark,
  type ViewCoordinator,
} from 'react-native-mediapipe-posedetection'
import type { NormalizedLandmark } from './landmarkIndices'

export interface PoseResult {
  /** 33 landmarks for the first detected person, or null if none detected. */
  landmarks: NormalizedLandmark[] | null
}

function toNormalized(landmarks: readonly MpLandmark[]): NormalizedLandmark[] {
  return landmarks.map((l) => ({
    x: l.x,
    y: l.y,
    z: l.z ?? 0,
    visibility: l.visibility ?? 0,
  }))
}

/**
 * Wires MediaPipe PoseLandmarker (GPU delegate, LIVE_STREAM mode) to a
 * VisionCamera frame processor. The plugin auto-throttles (default 15 fps);
 * `onResult` is invoked on the JS thread so it's safe to touch React state.
 *
 * Returns the `frameProcessor` and layout handlers to pass to <Camera/>.
 */
export function usePose(onResult: (r: PoseResult) => void): {
  frameProcessor: ReturnType<typeof usePoseDetection>['frameProcessor']
  onLayout: (e: LayoutChangeEvent) => void
} {
  const callbackRef = useRef(onResult)
  callbackRef.current = onResult

  const handleResults = useCallback(
    (bundle: PoseDetectionResultBundle, _vc: ViewCoordinator) => {
      const first = bundle.results[0]?.landmarks[0]
      callbackRef.current({
        landmarks: first && first.length > 0 ? toNormalized(first) : null,
      })
    },
    [],
  )

  const handleError = useCallback((_e: DetectionError) => {
    callbackRef.current({ landmarks: null })
  }, [])

  const pose = usePoseDetection(
    { onResults: handleResults, onError: handleError },
    RunningMode.LIVE_STREAM,
    'pose_landmarker_lite.task',
    { delegate: Delegate.GPU },
  )

  return {
    frameProcessor: pose.frameProcessor,
    onLayout: pose.cameraViewLayoutChangeHandler,
  }
}
