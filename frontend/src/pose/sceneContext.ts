import type { NormalizedLandmark } from './mediapipe'
import { LM } from './mediapipe'

/** Matches backend `NormalizedSubjectBBox`. */
export interface NormalizedSubjectBBox {
  x_min: number
  y_min: number
  x_max: number
  y_max: number
}

/** Matches backend `PoseVariantSceneContext` (JSON form). */
export interface PoseVariantSceneContextPayload {
  capture_width: number
  capture_height: number
  aspect_ratio: number
  subject_bbox: NormalizedSubjectBBox | null
  subject_fill_width: number | null
  subject_fill_height: number | null
  horizontal_placement: 'left' | 'center' | 'right' | 'unknown'
  framing_label: string
}

const VISIBILITY_THRESHOLD = 0.35
/** Torso, arms, and leg indices for a loose person bounding box. */
const BBOX_LANDMARK_INDICES: readonly number[] = [
  LM.NOSE,
  LM.L_SHOULDER,
  LM.R_SHOULDER,
  LM.L_ELBOW,
  LM.R_ELBOW,
  LM.L_WRIST,
  LM.R_WRIST,
  LM.L_HIP,
  LM.R_HIP,
  LM.L_KNEE,
  LM.R_KNEE,
  LM.L_ANKLE,
  LM.R_ANKLE,
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Build JSON-safe scene context. Landmarks are in video coordinates; the captured
 * reference JPEG is horizontally mirrored, so we mirror x (1 - x) to describe
 * the reference image the model receives.
 */
export function buildPoseVariantSceneContext(
  landmarks: NormalizedLandmark[] | null,
  videoWidth: number,
  videoHeight: number,
): PoseVariantSceneContextPayload {
  const w = Math.max(1, Math.floor(videoWidth))
  const h = Math.max(1, Math.floor(videoHeight))
  const aspect_ratio = w / h

  const base: PoseVariantSceneContextPayload = {
    capture_width: w,
    capture_height: h,
    aspect_ratio,
    subject_bbox: null,
    subject_fill_width: null,
    subject_fill_height: null,
    horizontal_placement: 'unknown',
    framing_label: 'no_pose_data',
  }

  if (!landmarks || landmarks.length < 29) {
    return base
  }

  let anyVisible = false
  let xMin = 1
  let yMin = 1
  let xMax = 0
  let yMax = 0

  for (const i of BBOX_LANDMARK_INDICES) {
    const p = landmarks[i]
    if (!p) continue
    const vis = p.visibility ?? 0
    if (vis < VISIBILITY_THRESHOLD) continue
    anyVisible = true
    const xMirrored = 1 - p.x
    xMin = Math.min(xMin, xMirrored)
    yMin = Math.min(yMin, p.y)
    xMax = Math.max(xMax, xMirrored)
    yMax = Math.max(yMax, p.y)
  }

  if (!anyVisible) {
    return { ...base, framing_label: 'low_visibility' }
  }

  const pad = 0.02
  const bbox: NormalizedSubjectBBox = {
    x_min: clamp(xMin - pad, 0, 1),
    y_min: clamp(yMin - pad, 0, 1),
    x_max: clamp(xMax + pad, 0, 1),
    y_max: clamp(yMax + pad, 0, 1),
  }
  const fw = bbox.x_max - bbox.x_min
  const fh = bbox.y_max - bbox.y_min

  const nose = landmarks[LM.NOSE]
  const noseVis = nose?.visibility ?? 0
  const anchorX =
    noseVis >= VISIBILITY_THRESHOLD && nose
      ? 1 - nose.x
      : (bbox.x_min + bbox.x_max) / 2

  let horizontal_placement: PoseVariantSceneContextPayload['horizontal_placement'] = 'center'
  if (anchorX < 0.38) horizontal_placement = 'left'
  else if (anchorX > 0.62) horizontal_placement = 'right'

  let framing_label: string
  if (fh < 0.45) {
    framing_label = 'environment_forward'
  } else if (fh < 0.72) {
    framing_label = 'upper_body'
  } else {
    framing_label = 'tight_portrait'
  }

  return {
    capture_width: w,
    capture_height: h,
    aspect_ratio,
    subject_bbox: bbox,
    subject_fill_width: fw,
    subject_fill_height: fh,
    horizontal_placement,
    framing_label,
  }
}
