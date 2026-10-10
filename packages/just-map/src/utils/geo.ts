import type { Coord } from './types'

const R = 6371

export function distKm(a: Coord, b: Coord) {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** cumulative normalized distance per vertex (lon scaled by cos(lat)) */
export function distanceFractions(coords: Coord[]): number[] {
  const cum = [0]

  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1]
    const [x1, y1] = coords[i]
    const dx = (x1 - x0) * Math.cos((y0 * Math.PI) / 180)
    cum.push(cum[i - 1] + Math.hypot(dx, y1 - y0))
  }

  const total = cum[cum.length - 1]
  return total > 0 ? cum.map(c => c / total) : cum.map(() => 0)
}

/** bearing in degrees, 0 = north */
export function bearingBetween(a: Coord, b: Coord) {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180)
  const dy = b[1] - a[1]
  return (Math.atan2(dx, dy) * 180) / Math.PI
}

/** total length in km */
export function lengthKm(coords: Coord[]) {
  let total = 0
  for (let i = 1; i < coords.length; i++) total += distKm(coords[i - 1], coords[i])
  return total
}

export function lerpCoord(a: Coord, b: Coord, u: number): Coord {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
}

/** degrees along the shortest arc, result in [0, 360) */
export function lerpAngle(a: number, b: number, u: number) {
  const delta = ((((b - a) % 360) + 540) % 360) - 180
  return (((a + delta * u) % 360) + 360) % 360
}

/** area-weighted centroid of a ring, open or closed; vertex mean when degenerate */
export function ringCentroid(ring: Coord[]): Coord {
  // relative to the first vertex, so large absolute coordinates don't cancel out small areas
  const [ox, oy] = ring[0]
  let area = 0
  let cx = 0
  let cy = 0

  for (let i = 0; i < ring.length; i++) {
    const x0 = ring[i][0] - ox
    const y0 = ring[i][1] - oy
    const x1 = ring[(i + 1) % ring.length][0] - ox
    const y1 = ring[(i + 1) % ring.length][1] - oy
    const cross = x0 * y1 - x1 * y0
    area += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }

  if (Math.abs(area) < 1e-14) {
    const mean = (k: 0 | 1) => ring.reduce((sum, c) => sum + c[k], 0) / ring.length
    return [mean(0), mean(1)]
  }
  return [ox + cx / (3 * area), oy + cy / (3 * area)]
}
