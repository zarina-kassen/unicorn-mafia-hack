/**
 * MediaPipe Pose landmark indices, re-exported under the same `LM` name the
 * matcher uses so `matcher.ts` and `templates.ts` are verbatim ports of the
 * web version.
 */
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
} as const

/**
 * Subset of MediaPipe's pose skeleton rendered by the overlay. Face mesh +
 * hands + feet are excluded to keep the outline legible.
 */
export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
]

export interface NormalizedLandmark {
  x: number
  y: number
  z: number
  visibility: number
}
