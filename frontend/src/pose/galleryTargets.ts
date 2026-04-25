import { LM, type NormalizedLandmark } from './mediapipe'
import type { PoseTemplate } from './templates'

export interface GalleryPose {
  id: string
  title: string
  instruction: string
  imageSrc: string
  replaceableAsset?: boolean
  template: PoseTemplate
}

function buildLandmarks(
  positions: Partial<Record<number, [number, number]>>,
): NormalizedLandmark[] {
  const out: NormalizedLandmark[] = []
  for (let i = 0; i < 33; i += 1) {
    const point = positions[i]
    out.push(
      point
        ? { x: point[0], y: point[1], z: 0, visibility: 1 }
        : { x: 0, y: 0, z: 0, visibility: 0 },
    )
  }
  return out
}

function makeTemplate(
  name: string,
  positions: Partial<Record<number, [number, number]>>,
): PoseTemplate {
  return {
    id: 'hand_on_hip',
    name,
    posture: 'standing',
    guidance: '',
    landmarks: buildLandmarks(positions),
  }
}

const armsCrossed = makeTemplate('Arms crossed', {
  [LM.NOSE]: [0.5, 0.2],
  [LM.L_SHOULDER]: [0.36, 0.36],
  [LM.R_SHOULDER]: [0.64, 0.36],
  [LM.L_ELBOW]: [0.28, 0.58],
  [LM.R_ELBOW]: [0.72, 0.58],
  [LM.L_WRIST]: [0.58, 0.64],
  [LM.R_WRIST]: [0.42, 0.64],
  [LM.L_HIP]: [0.39, 0.84],
  [LM.R_HIP]: [0.61, 0.84],
})

const relaxedTurn = makeTemplate('Relaxed turn', {
  [LM.NOSE]: [0.47, 0.2],
  [LM.L_SHOULDER]: [0.34, 0.36],
  [LM.R_SHOULDER]: [0.67, 0.4],
  [LM.L_ELBOW]: [0.31, 0.62],
  [LM.R_ELBOW]: [0.7, 0.66],
  [LM.L_WRIST]: [0.35, 0.82],
  [LM.R_WRIST]: [0.69, 0.84],
  [LM.L_HIP]: [0.4, 0.88],
  [LM.R_HIP]: [0.63, 0.9],
})

const chinHand = makeTemplate('Chin hand', {
  [LM.NOSE]: [0.51, 0.2],
  [LM.L_SHOULDER]: [0.35, 0.37],
  [LM.R_SHOULDER]: [0.65, 0.36],
  [LM.L_ELBOW]: [0.28, 0.6],
  [LM.R_ELBOW]: [0.58, 0.58],
  [LM.L_WRIST]: [0.6, 0.68],
  [LM.R_WRIST]: [0.52, 0.39],
  [LM.L_HIP]: [0.38, 0.86],
  [LM.R_HIP]: [0.62, 0.86],
})

const lookAway = makeTemplate('Look away', {
  [LM.NOSE]: [0.42, 0.2],
  [LM.L_SHOULDER]: [0.34, 0.38],
  [LM.R_SHOULDER]: [0.64, 0.4],
  [LM.L_ELBOW]: [0.25, 0.65],
  [LM.R_ELBOW]: [0.66, 0.66],
  [LM.L_WRIST]: [0.25, 0.86],
  [LM.R_WRIST]: [0.65, 0.86],
  [LM.L_HIP]: [0.38, 0.88],
  [LM.R_HIP]: [0.62, 0.9],
})

const handsTable = makeTemplate('Hands forward', {
  [LM.NOSE]: [0.5, 0.2],
  [LM.L_SHOULDER]: [0.36, 0.37],
  [LM.R_SHOULDER]: [0.64, 0.37],
  [LM.L_ELBOW]: [0.34, 0.63],
  [LM.R_ELBOW]: [0.66, 0.63],
  [LM.L_WRIST]: [0.45, 0.83],
  [LM.R_WRIST]: [0.55, 0.83],
  [LM.L_HIP]: [0.39, 0.89],
  [LM.R_HIP]: [0.61, 0.89],
})

const angledCross = makeTemplate('Angled cross', {
  [LM.NOSE]: [0.53, 0.2],
  [LM.L_SHOULDER]: [0.39, 0.38],
  [LM.R_SHOULDER]: [0.67, 0.36],
  [LM.L_ELBOW]: [0.32, 0.6],
  [LM.R_ELBOW]: [0.73, 0.56],
  [LM.L_WRIST]: [0.6, 0.65],
  [LM.R_WRIST]: [0.44, 0.64],
  [LM.L_HIP]: [0.42, 0.86],
  [LM.R_HIP]: [0.65, 0.84],
})

export const GALLERY_POSES: GalleryPose[] = [
  {
    id: 'pose-01',
    title: 'Crossed arms',
    instruction: 'Cross your arms and square your shoulders.',
    imageSrc: '/pose-gallery/pose-01.jpg',
    template: armsCrossed,
  },
  {
    id: 'pose-02',
    title: 'Relaxed turn',
    instruction: 'Turn your body slightly and relax both arms.',
    imageSrc: '/pose-gallery/pose-02.jpg',
    template: relaxedTurn,
  },
  {
    id: 'pose-03',
    title: 'Thoughtful',
    instruction: 'Bring one hand up near your chin.',
    imageSrc: '/pose-gallery/pose-03.jpg',
    template: chinHand,
  },
  {
    id: 'pose-04',
    title: 'Look away',
    instruction: 'Turn your head slightly to the side.',
    imageSrc: '/pose-gallery/pose-04.jpg',
    template: lookAway,
  },
  {
    id: 'pose-05',
    title: 'Hands forward',
    instruction: 'Bring both hands forward and keep shoulders level.',
    imageSrc: '/pose-gallery/pose-05.jpg',
    template: handsTable,
  },
  {
    id: 'pose-06',
    title: 'Angled cross',
    instruction: 'Angle your body, then cross your arms.',
    imageSrc: '/pose-gallery/pose-06.jpg',
    template: angledCross,
  },
  {
    id: 'pose-07',
    title: 'Chin variant',
    instruction: 'Lift one hand to your chin and keep your other arm low.',
    imageSrc: '/pose-gallery/pose-07.jpg',
    replaceableAsset: true,
    template: chinHand,
  },
  {
    id: 'pose-08',
    title: 'Side variant',
    instruction: 'Look to the side and keep your torso tall.',
    imageSrc: '/pose-gallery/pose-08.jpg',
    replaceableAsset: true,
    template: lookAway,
  },
  {
    id: 'pose-09',
    title: 'Table variant',
    instruction: 'Set both hands forward near the bottom of frame.',
    imageSrc: '/pose-gallery/pose-09.jpg',
    replaceableAsset: true,
    template: handsTable,
  },
  {
    id: 'pose-10',
    title: 'Cross variant',
    instruction: 'Cross your arms with a slight body angle.',
    imageSrc: '/pose-gallery/pose-10.jpg',
    replaceableAsset: true,
    template: angledCross,
  },
]
