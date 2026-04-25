import type { NormalizedLandmark } from './pose/landmarkIndices'

/** Matches backend/app/schemas.py::GuidanceResponse. */
export interface GuidanceResponse {
  recommended_template_id: string
  confidence: number
  guidance: string
  person_visible: boolean
  pose_aligned: boolean
  suggest_different: boolean
  reason: string
}

/** Matches backend/app/schemas.py::PoseContext. */
export interface PoseContextPayload {
  landmarks: NormalizedLandmark[]
  candidate_template_id: string
  local_confidence: number
  image_wh: [number, number]
  snapshot_b64?: string | null
}
