import type { NormalizedLandmark } from './mediapipe'
import { LM } from './mediapipe'

export type PoseTemplateId =
  | 'standing_straight'
  | 'hand_on_hip'
  | 'seated_relaxed'
  | 'seated_crossed_legs'
  | 'leaning_casual'

export interface PoseTemplate {
  id: PoseTemplateId
  name: string
  posture: 'standing' | 'seated' | 'leaning'
  /** 33 normalized landmarks in image-relative coords (x,y in [0,1]). */
  landmarks: NormalizedLandmark[]
  /** Local fallback guidance if the backend is unreachable. */
  guidance: string
}

/**
 * Build a 33-entry landmark array from a sparse index→[x,y] map. Landmarks
 * not listed get visibility=0 so the matcher and overlay ignore them.
 */
function buildLandmarks(
  positions: Partial<Record<number, [number, number]>>,
): NormalizedLandmark[] {
  const out: NormalizedLandmark[] = []
  for (let i = 0; i < 33; i += 1) {
    const p = positions[i]
    if (p) {
      out.push({ x: p[0], y: p[1], z: 0, visibility: 1 })
    } else {
      out.push({ x: 0, y: 0, z: 0, visibility: 0 })
    }
  }
  return out
}

/** Straight full-body frontal pose. */
const standingStraight: PoseTemplate = {
  id: 'standing_straight',
  name: 'Standing straight',
  posture: 'standing',
  guidance: 'Stand tall, shoulders level, arms relaxed at your sides.',
  landmarks: buildLandmarks({
    [LM.NOSE]: [0.5, 0.15],
    [LM.L_SHOULDER]: [0.42, 0.28],
    [LM.R_SHOULDER]: [0.58, 0.28],
    [LM.L_ELBOW]: [0.4, 0.44],
    [LM.R_ELBOW]: [0.6, 0.44],
    [LM.L_WRIST]: [0.39, 0.58],
    [LM.R_WRIST]: [0.61, 0.58],
    [LM.L_HIP]: [0.44, 0.55],
    [LM.R_HIP]: [0.56, 0.55],
    [LM.L_KNEE]: [0.44, 0.74],
    [LM.R_KNEE]: [0.56, 0.74],
    [LM.L_ANKLE]: [0.44, 0.92],
    [LM.R_ANKLE]: [0.56, 0.92],
  }),
}

/** Standing with the left wrist resting on the left hip. */
const handOnHip: PoseTemplate = {
  id: 'hand_on_hip',
  name: 'Hand on hip',
  posture: 'standing',
  guidance: 'Place one hand on your hip, keep shoulders level and chin up.',
  landmarks: buildLandmarks({
    [LM.NOSE]: [0.5, 0.15],
    [LM.L_SHOULDER]: [0.42, 0.28],
    [LM.R_SHOULDER]: [0.58, 0.28],
    [LM.L_ELBOW]: [0.34, 0.44],
    [LM.R_ELBOW]: [0.6, 0.44],
    [LM.L_WRIST]: [0.405, 0.5],
    [LM.R_WRIST]: [0.61, 0.58],
    [LM.L_HIP]: [0.44, 0.55],
    [LM.R_HIP]: [0.56, 0.55],
    [LM.L_KNEE]: [0.44, 0.74],
    [LM.R_KNEE]: [0.56, 0.74],
    [LM.L_ANKLE]: [0.44, 0.92],
    [LM.R_ANKLE]: [0.56, 0.92],
  }),
}

/** Seated upright, hands resting on lap. */
const seatedRelaxed: PoseTemplate = {
  id: 'seated_relaxed',
  name: 'Seated relaxed',
  posture: 'seated',
  guidance: 'Sit tall, both feet on the floor, hands gently resting on your lap.',
  landmarks: buildLandmarks({
    [LM.NOSE]: [0.5, 0.22],
    [LM.L_SHOULDER]: [0.42, 0.35],
    [LM.R_SHOULDER]: [0.58, 0.35],
    [LM.L_ELBOW]: [0.4, 0.5],
    [LM.R_ELBOW]: [0.6, 0.5],
    [LM.L_WRIST]: [0.46, 0.66],
    [LM.R_WRIST]: [0.54, 0.66],
    [LM.L_HIP]: [0.44, 0.6],
    [LM.R_HIP]: [0.56, 0.6],
    [LM.L_KNEE]: [0.4, 0.68],
    [LM.R_KNEE]: [0.6, 0.68],
    [LM.L_ANKLE]: [0.42, 0.88],
    [LM.R_ANKLE]: [0.58, 0.88],
  }),
}

/** Seated with one leg crossed over the other (left over right). */
const seatedCrossedLegs: PoseTemplate = {
  id: 'seated_crossed_legs',
  name: 'Seated, crossed legs',
  posture: 'seated',
  guidance: 'Cross one leg over the other, keep torso upright and relaxed.',
  landmarks: buildLandmarks({
    [LM.NOSE]: [0.5, 0.22],
    [LM.L_SHOULDER]: [0.42, 0.35],
    [LM.R_SHOULDER]: [0.58, 0.35],
    [LM.L_ELBOW]: [0.4, 0.5],
    [LM.R_ELBOW]: [0.6, 0.5],
    [LM.L_WRIST]: [0.47, 0.66],
    [LM.R_WRIST]: [0.53, 0.66],
    [LM.L_HIP]: [0.44, 0.6],
    [LM.R_HIP]: [0.56, 0.6],
    [LM.L_KNEE]: [0.54, 0.7], // crossed toward the right
    [LM.R_KNEE]: [0.46, 0.72],
    [LM.L_ANKLE]: [0.6, 0.82],
    [LM.R_ANKLE]: [0.4, 0.86],
  }),
}

/** Casual lean to the right with weight on the left leg. */
const leaningCasual: PoseTemplate = {
  id: 'leaning_casual',
  name: 'Leaning casual',
  posture: 'leaning',
  guidance: 'Put your weight on one leg and let the other relax. Keep shoulders easy.',
  landmarks: buildLandmarks({
    [LM.NOSE]: [0.52, 0.15],
    [LM.L_SHOULDER]: [0.44, 0.3],
    [LM.R_SHOULDER]: [0.6, 0.26],
    [LM.L_ELBOW]: [0.42, 0.45],
    [LM.R_ELBOW]: [0.62, 0.42],
    [LM.L_WRIST]: [0.41, 0.58],
    [LM.R_WRIST]: [0.63, 0.56],
    [LM.L_HIP]: [0.46, 0.58],
    [LM.R_HIP]: [0.58, 0.56],
    [LM.L_KNEE]: [0.46, 0.76],
    [LM.R_KNEE]: [0.59, 0.74],
    [LM.L_ANKLE]: [0.46, 0.94],
    [LM.R_ANKLE]: [0.58, 0.92],
  }),
}

export const TEMPLATES: PoseTemplate[] = [
  standingStraight,
  handOnHip,
  seatedRelaxed,
  seatedCrossedLegs,
  leaningCasual,
]

export function getTemplate(id: PoseTemplateId | string): PoseTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? standingStraight
}
