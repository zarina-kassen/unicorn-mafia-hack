import { LM, type NormalizedLandmark } from './landmarkIndices'
import type { PoseTemplate, PoseTemplateId } from './templates'

const MATCH_JOINTS: readonly number[] = [
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
]

interface NormalizedPose {
  /** Flat [dx0, dy0, ...] relative to hip center, torso-normalized. */
  vec: number[]
  visibility: number
}

function normalize(landmarks: NormalizedLandmark[]): NormalizedPose | null {
  if (landmarks.length < 33) return null
  const ls = landmarks[LM.L_SHOULDER]
  const rs = landmarks[LM.R_SHOULDER]
  const lh = landmarks[LM.L_HIP]
  const rh = landmarks[LM.R_HIP]
  if ((ls.visibility ?? 0) < 0.3 || (rs.visibility ?? 0) < 0.3) return null
  if ((lh.visibility ?? 0) < 0.3 || (rh.visibility ?? 0) < 0.3) return null
  const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
  const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
  const torso = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y)
  if (torso < 1e-4) return null

  const vec: number[] = []
  let visSum = 0
  for (const idx of MATCH_JOINTS) {
    const p = landmarks[idx]
    vec.push((p.x - hipMid.x) / torso, (p.y - hipMid.y) / torso)
    visSum += p.visibility ?? 0
  }
  return { vec, visibility: visSum / MATCH_JOINTS.length }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  if (denom < 1e-6) return 0
  return dot / denom
}

export interface TemplateMatch {
  templateId: PoseTemplateId
  score: number
  personVisible: boolean
}

/**
 * Compare a live pose against all templates. Returns the best match plus a
 * normalized similarity score in [0, 1]. When the user is not sufficiently
 * visible the function reports `personVisible=false` and returns 0.
 */
export function matchTemplate(
  live: NormalizedLandmark[],
  templates: PoseTemplate[],
): TemplateMatch {
  const liveNorm = normalize(live)
  if (!liveNorm) {
    return { templateId: templates[0].id, score: 0, personVisible: false }
  }

  let best: { id: PoseTemplateId; score: number } = {
    id: templates[0].id,
    score: -Infinity,
  }
  for (const t of templates) {
    const tNorm = normalize(t.landmarks)
    if (!tNorm) continue
    const similarity = cosine(liveNorm.vec, tNorm.vec)
    if (similarity > best.score) best = { id: t.id, score: similarity }
  }

  const score = Math.max(0, Math.min(1, (best.score + 1) / 2))
  return { templateId: best.id, score, personVisible: liveNorm.visibility > 0.4 }
}
