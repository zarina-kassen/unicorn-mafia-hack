import type { NormalizedLandmark } from '../pose/mediapipe'

export interface GuidanceResponse {
  recommended_target_id: string
  confidence: number
  guidance: string
  person_visible: boolean
  pose_aligned: boolean
  suggest_different: boolean
  reason: string
}

export interface PoseContextPayload {
  landmarks: NormalizedLandmark[]
  active_target_id: string
  local_confidence: number
  image_wh: [number, number]
  snapshot_b64?: string | null
}

export interface PoseVariantResult {
  id: string
  slot_index: number
  title: string
  instruction: string
  image_url: string
  target_id: string
  target_landmarks: NormalizedLandmark[]
  replaceable: boolean
  tier: 'fast' | 'hq'
  model: string
}
