import { useMemo } from 'react'
import { Canvas, Circle, Group, Line, Skia } from '@shopify/react-native-skia'
import {
  POSE_CONNECTIONS,
  type NormalizedLandmark,
} from '../pose/landmarkIndices'
import type { PoseTemplate } from '../pose/templates'

export interface PoseOverlayProps {
  width: number
  height: number
  template: PoseTemplate | null
  live: NormalizedLandmark[] | null
  /** Mirror horizontally (selfie view). Default true. */
  mirror?: boolean
}

const TARGET_COLOR = '#67e8f9' // cyan-300
const LIVE_COLOR = '#facc15' // yellow-400
const MIN_VIS = 0.4

interface DrawPoint {
  x: number
  y: number
  visibility: number
}

function toPoints(
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  mirror: boolean,
): DrawPoint[] {
  return landmarks.map((lm) => ({
    x: (mirror ? 1 - lm.x : lm.x) * width,
    y: lm.y * height,
    visibility: lm.visibility,
  }))
}

function Skeleton({
  points,
  color,
  strokeWidth,
  radius,
}: {
  points: DrawPoint[]
  color: string
  strokeWidth: number
  radius: number
}) {
  const paint = useMemo(() => {
    const p = Skia.Paint()
    p.setColor(Skia.Color(color))
    p.setStrokeWidth(strokeWidth)
    p.setAntiAlias(true)
    return p
  }, [color, strokeWidth])

  return (
    <Group>
      {POSE_CONNECTIONS.map(([a, b], idx) => {
        const pa = points[a]
        const pb = points[b]
        if (!pa || !pb) return null
        if (pa.visibility < MIN_VIS || pb.visibility < MIN_VIS) return null
        return (
          <Line
            key={`c-${idx}`}
            p1={{ x: pa.x, y: pa.y }}
            p2={{ x: pb.x, y: pb.y }}
            color={color}
            strokeWidth={strokeWidth}
            paint={paint}
          />
        )
      })}
      {points.map((p, idx) =>
        p.visibility < MIN_VIS ? null : (
          <Circle key={`p-${idx}`} cx={p.x} cy={p.y} r={radius} color={color} />
        ),
      )}
    </Group>
  )
}

/**
 * Full-screen Skia overlay drawing the target template (cyan) and the live
 * pose (yellow). Never awaits the backend; redraws every React commit.
 */
export function PoseOverlay({
  width,
  height,
  template,
  live,
  mirror = true,
}: PoseOverlayProps) {
  const targetPoints = useMemo(
    () => (template ? toPoints(template.landmarks, width, height, mirror) : null),
    [template, width, height, mirror],
  )
  const livePoints = useMemo(
    () => (live ? toPoints(live, width, height, mirror) : null),
    [live, width, height, mirror],
  )

  return (
    <Canvas style={{ position: 'absolute', left: 0, top: 0, width, height }}>
      {targetPoints && (
        <Skeleton
          points={targetPoints}
          color={TARGET_COLOR}
          strokeWidth={4}
          radius={5}
        />
      )}
      {livePoints && (
        <Skeleton
          points={livePoints}
          color={LIVE_COLOR}
          strokeWidth={3}
          radius={4}
        />
      )}
    </Canvas>
  )
}
