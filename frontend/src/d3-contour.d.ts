declare module 'd3-contour' {
  interface ContourLayer {
    /** MultiPolygon-style: polygon → linear ring → [x, y] pairs. */
    coordinates: ReadonlyArray<ReadonlyArray<ReadonlyArray<readonly [number, number]>>>
  }

  interface ContourGenerator {
    size(dimensions: [number, number]): ContourGenerator
    smooth(value: boolean): ContourGenerator
    thresholds(values: number[]): ContourGenerator
    (grid: Float32Array): ContourLayer[]
  }

  export function contours(): ContourGenerator
}
