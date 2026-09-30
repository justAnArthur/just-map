import { distKm, lengthKm } from '../utils/geo'
import type { Coord, Fix, Track } from '../utils/types'

export type SnapOptions = {
  /** OSRM base URL — the public demo server by default; self-host in production */
  baseUrl?: string
  profile?: string
  /** the public server caps /match at ~10 points per request */
  chunkSize?: number
  overlap?: number
  /** politeness delay between chunk requests */
  delayMs?: number
}

export type MatchResult = {
  coords: Coord[]
  /** mean OSRM confidence across chunks */
  confidence: number
  distanceKm: number
}

// OSRM only cares about timestamp deltas
const EPOCH = 1_759_056_720

type Chunk = { coordinates: Coord[]; confidence: number }

async function matchChunk(fixes: Fix[], baseUrl: string, profile: string): Promise<Chunk> {
  const coordStr = fixes.map(f => `${f.coord[0].toFixed(6)},${f.coord[1].toFixed(6)}`).join(';')
  const tsStr = fixes.map(f => Math.round(EPOCH + f.t)).join(';')

  const res = await fetch(
    `${baseUrl}/match/v1/${profile}/${coordStr}?timestamps=${tsStr}&geometries=geojson&overview=full&steps=false&annotations=false`,
  )
  const data = (await res.json()) as {
    code: string
    matchings?: { geometry: { coordinates: Coord[] }; confidence: number }[]
  }

  if (data.code !== 'Ok' || !data.matchings?.length)
    throw new Error(`just-map: OSRM match failed: ${data.code}${data.code === 'TooBig' ? ' — lower chunkSize' : ''}`)

  // a gap in the fixes can split one chunk into several matchings; keep the longest
  const best = data.matchings.reduce((a, b) => (b.geometry.coordinates.length > a.geometry.coordinates.length ? b : a))
  return { coordinates: best.geometry.coordinates, confidence: best.confidence }
}

/**
 * Snap sparse GPS fixes onto the road network (OSRM /match).
 * Long trails are matched in overlapping chunks and stitched, so the ~10-point
 * cap of the public demo server is not a limit.
 */
export async function snapToRoad(
  fixes: Fix[],
  { baseUrl = 'https://router.project-osrm.org', profile = 'driving', chunkSize = 10, overlap = 1, delayMs = 250 }: SnapOptions = {},
): Promise<MatchResult> {
  if (fixes.length < 2) throw new Error('just-map: snapToRoad needs at least 2 fixes')

  const step = Math.max(1, chunkSize - overlap)
  const chunks: Chunk[] = []

  for (let start = 0; start < fixes.length - 1; start += step) {
    chunks.push(await matchChunk(fixes.slice(start, start + chunkSize), baseUrl, profile))

    if (start + step < fixes.length - 1) await new Promise(r => setTimeout(r, delayMs))
  }

  // each chunk's first vertex re-covers the previous chunk's last fix — drop it
  const coords: Coord[] = []
  for (const c of chunks) {
    for (let k = coords.length ? 1 : 0; k < c.coordinates.length; k++) {
      const prev = coords[coords.length - 1]
      if (prev && prev[0] === c.coordinates[k][0] && prev[1] === c.coordinates[k][1]) continue
      coords.push(c.coordinates[k])
    }
  }

  return {
    coords,
    confidence: chunks.reduce((a, c) => a + c.confidence, 0) / chunks.length,
    distanceKm: lengthKm(coords),
  }
}

export type MatchedTrack = Track & { confidence: number; distanceKm: number }

/**
 * Raw GPS fixes → a ready-to-display track: road-snapped geometry with a
 * time/speed profile rebuilt by interpolating the fix timestamps along arc
 * length. This is the "routes from GPS coordinates" one-liner.
 */
export async function fromGpsFixes(
  fixes: Fix[],
  { id = 'matched', name, maxVertices = 500, ...snap }: SnapOptions & { id?: string; name?: string; maxVertices?: number } = {},
): Promise<MatchedTrack> {
  const match = await snapToRoad(fixes, snap)

  // fraction of total chord distance at each fix — the time anchors
  const cum = [0]
  for (let i = 1; i < fixes.length; i++) cum.push(cum[i - 1] + distKm(fixes[i - 1].coord, fixes[i].coord))
  const total = cum[cum.length - 1] || 1

  const tAt = (f: number) => {
    const g = Math.min(1, Math.max(0, f))
    let j = 1
    while (j < fixes.length - 1 && cum[j] / total < g) j++

    const flo = cum[j - 1] / total
    const fhi = cum[j] / total
    return fixes[j - 1].t + ((g - flo) / (fhi - flo || 1)) * (fixes[j].t - fixes[j - 1].t)
  }

  const stride = Math.max(1, Math.ceil(match.coords.length / maxVertices))
  const coords = match.coords
    .filter((_, i) => i % stride === 0 || i === match.coords.length - 1)
    .map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] as Coord)

  const mcum = [0]
  for (let k = 1; k < coords.length; k++) mcum.push(mcum[k - 1] + distKm(coords[k - 1], coords[k]))
  const mTotal = mcum[mcum.length - 1] || 1

  const times: number[] = []
  let prev = -1
  for (let k = 0; k < coords.length; k++) {
    const t = Math.max(prev + 0.5, Math.round(tAt(mcum[k] / mTotal)))
    times.push(t)
    prev = t
  }

  const rawSpeeds = coords.map((_, k) => {
    if (k === 0) return 0
    const dt = times[k] - times[k - 1]
    return dt <= 0 ? 0 : (distKm(coords[k - 1], coords[k]) / dt) * 3600
  })

  const speeds = rawSpeeds.map((_, k) => {
    const win = rawSpeeds.slice(Math.max(0, k - 2), k + 3)
    return Math.round(Math.min(138, Math.max(2, win.reduce((s, v) => s + v, 0) / win.length)) * 10) / 10
  })

  return { id, name, coords, times, speeds, confidence: match.confidence, distanceKm: match.distanceKm }
}
