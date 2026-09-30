export type Coord = [number, number]

/** one raw GPS position */
export type Fix = {
  coord: Coord
  /** seconds since track start */
  t: number
  /** km/h */
  speed?: number
}

/** a path with optional per-vertex telemetry */
export type Track = {
  id: string
  name?: string
  coords: Coord[]
  /** seconds since track start, one per coord */
  times?: number[]
  /** km/h, one per coord */
  speeds?: number[]
  /** per-vertex numeric properties, for `colorBy: { property: ... }` */
  properties?: Record<string, number>[]
}
