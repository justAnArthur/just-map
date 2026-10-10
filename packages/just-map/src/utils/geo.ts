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
