// Simulates what camasys stores today — a sparse GPS breadcrumb trail (one fix
// every ~20–35s with consumer-GPS jitter) — then map-matches it onto the road
// network with OSRM /match. The generated src/data/gps.ts carries BOTH versions
// so the demo can show raw straight-lines vs. road-snapped side by side.
// Run: bun scripts/generate-gps.ts
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { trips } from "../src/data/trips"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const R = 6371
function distKm(a: [number, number], b: [number, number]) {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// TR-2411 (airport pickup), minus its first stretch: right at the terminal two
// airport access roads are both plausible to a sparse matcher, which reliably
// picks the wrong one for ~2km. The demo trail starts where the drive becomes
// unambiguous — the sparse-dots-vs-road-snap story is unchanged.
const START_AT = 75
const base = {
  ...trips[0],
  coords: trips[0].coords.slice(START_AT) as [number, number][],
  times: trips[0].times.slice(START_AT).map((t) => t - trips[0].times[START_AT]),
}

const cum = [0]
for (let k = 1; k < base.coords.length; k++) cum.push(cum[k - 1] + distKm(base.coords[k - 1], base.coords[k]))
const totalKm = cum[cum.length - 1]

// --- 1. Sparse breadcrumbs: tracker reports roughly every 20–35s -----------------
// Sparseness is what makes camasys's straight lines cut corners; it stays generous
// so the demo contrast is honest.
const rndCrumbs = mulberry32(777)
const crumbs: { coord: [number, number]; t: number; f: number }[] = []
let nextT = -1
for (let k = 0; k < base.coords.length; k++) {
  if (k === 0 || k === base.coords.length - 1 || base.times[k] >= nextT) {
    crumbs.push({ coord: [...base.coords[k]], t: base.times[k], f: cum[k] / totalKm })
    nextT = base.times[k] + 20 + rndCrumbs() * 15
  }
}

// --- 2. Map-match via OSRM ------------------------------------------------------
// The public demo server caps /match at ~10 points ("TooBig" beyond that), so we
// slide a 10-point window with 1-point overlap across the trail and stitch the
// per-chunk geometries — the same pattern a production client uses. A self-hosted
// OSRM raises --max-matching-size and needs no chunking.
const t0 = 1_759_056_720 // arbitrary epoch base; OSRM only cares about deltas
const CHUNK = 10

async function matchChunk(slice: { coord: [number, number]; t: number }[]) {
  const coordStr = slice.map((c) => `${c.coord[0].toFixed(6)},${c.coord[1].toFixed(6)}`).join(";")
  const tsStr = slice.map((c) => Math.round(t0 + c.t)).join(";")
  const res = await fetch(
    `https://router.project-osrm.org/match/v1/driving/${coordStr}?timestamps=${tsStr}&geometries=geojson&overview=full&steps=false&annotations=false`,
  )
  const data = (await res.json()) as {
    code: string
    matchings: { geometry: { coordinates: [number, number][] }; confidence: number }[]
  }
  if (data.code !== "Ok") throw new Error(`OSRM match failed: ${data.code}`)
  return data.matchings.reduce((a, b) => (b.geometry.coordinates.length > a.geometry.coordinates.length ? b : a))
}

// Attempt matching at decreasing noise levels until the result tracks the known
// true route. (Real map matching has failure modes — e.g. fixes alternating
// between dual carriageways can force a U-turn route between them — so the
// generator validates its own output: we know the road the "car" drove.)
const NOISE = [
  { sigma: 0.00008, outlier: 0.0003 }, // σ≈9m + ~35m multipath outliers
  { sigma: 0.00006, outlier: 0.00025 },
  { sigma: 0.00005, outlier: 0.0002 },
  { sigma: 0.00004, outlier: 0 },
  { sigma: 0.00003, outlier: 0 }, // σ≈3.5m, clean consumer fix
]

function nearestToTrueRoute(v: [number, number]) {
  let best = Infinity
  for (const o of base.coords) {
    const d = distKm(v, o)
    if (d < best) best = d
    if (best < 0.005) break
  }
  return best
}

let raw: { coord: [number, number]; t: number; f: number }[] = []
let stitched: [number, number][] = []
let confidence = 0

for (let attempt = 0; attempt < NOISE.length; attempt++) {
  const { sigma, outlier } = NOISE[attempt]
  const rnd = mulberry32(9000 + attempt)
  const gauss = () => {
    const u = Math.max(1e-9, rnd())
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
  }
  raw = crumbs.map((c, idx) => {
    const spike =
      outlier > 0 && idx % 11 === 5 && idx !== 0 && idx !== crumbs.length - 1 ? outlier * (0.8 + rnd() * 0.4) : 0
    const a = rnd() * 2 * Math.PI
    const r = Math.abs(gauss()) * sigma + spike
    return { ...c, coord: [c.coord[0] + Math.cos(a) * r, c.coord[1] + Math.sin(a) * r] as [number, number] }
  })

  const chunks: { coordinates: [number, number][]; confidence: number }[] = []
  for (let start = 0; start < raw.length - 1; start += CHUNK - 1) {
    const m = await matchChunk(raw.slice(start, start + CHUNK))
    chunks.push({ coordinates: m.geometry.coordinates, confidence: m.confidence })
    await new Promise((r) => setTimeout(r, 400)) // be polite to the demo server
  }
  // Stitch: drop each chunk's first vertex (it re-covers the previous chunk's last fix).
  const s: [number, number][] = []
  for (const c of chunks) {
    for (let k = s.length ? 1 : 0; k < c.coordinates.length; k++) {
      const prev = s[s.length - 1]
      if (prev && prev[0] === c.coordinates[k][0] && prev[1] === c.coordinates[k][1]) continue
      s.push(c.coordinates[k])
    }
  }
  const mKm = s.reduce((acc, v, i) => (i ? acc + distKm(s[i - 1], v) : 0), 0)
  const far = s.filter((v) => nearestToTrueRoute(v) > 0.06).length
  // Reverse direction: base-route vertices must be covered by the match too —
  // otherwise the matcher shortcut a section. Individual vertices can sit >100m
  // from the coarser matched polyline where it chords across a curve, so only
  // runs of ≥5 consecutive uncovered vertices (~200m+ of arc) count as skips.
  let uncoveredRun = 0
  let longRuns = 0
  for (const o of base.coords) {
    let best = Infinity
    for (const v of s) {
      const d = distKm(o, v)
      if (d < best) best = d
      if (best < 0.005) break
    }
    if (best > 0.1) {
      if (++uncoveredRun === 5) longRuns++
    } else uncoveredRun = 0
  }
  // Chord-sums of differently-dense polylines differ by a few % — ratio is only a
  // coarse sanity bound; road correspondence above is the real check.
  const ratio = mKm / totalKm
  console.log(
    `attempt ${attempt + 1} (σ=${(sigma * 111000).toFixed(0)}m, outlier=${Math.round(outlier * 111000)}m): ` +
      `${raw.length} fixes → ${s.length} vertices, off-route ${far}, skipped-sections ${longRuns}, ratio ${ratio.toFixed(3)}, conf ` +
      `${(chunks.reduce((a, c) => a + c.confidence, 0) / chunks.length).toFixed(2)}`,
  )
  if (far === 0 && longRuns === 0 && ratio > 0.85 && ratio < 1.15) {
    stitched = s
    confidence = chunks.reduce((a, c) => a + c.confidence, 0) / chunks.length
    break
  }
}
if (!stitched.length) throw new Error("no attempt produced a clean match — tune NOISE or the base route")
console.log(`accepted: confidence ${confidence.toFixed(2)}`)

// --- 3. Rebuild a time/speed profile on the matched geometry ---------------------
// Cap vertex count like generate-trips does, then interpolate timestamps along
// arc length between the (fraction, t) anchors of the raw breadcrumbs.
const all = stitched
const stride = Math.max(1, Math.ceil(all.length / 500))
const coords = all
  .filter((_, idx) => idx % stride === 0 || idx === all.length - 1)
  .map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] as [number, number])

const mcum = [0]
for (let k = 1; k < coords.length; k++) mcum.push(mcum[k - 1] + distKm(coords[k - 1], coords[k]))
const mTotal = mcum[mcum.length - 1] || 1

const tAt = (f: number) => {
  const g = Math.min(1, Math.max(0, f))
  let j = 1
  while (j < raw.length - 1 && raw[j].f < g) j++
  const lo = raw[j - 1]
  const hi = raw[j]
  return lo.t + ((g - lo.f) / (hi.f - lo.f || 1)) * (hi.t - lo.t)
}

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

// --- 4. Focus point: where the raw straight-line track strays furthest from the road.
// The fixes themselves sit on the road; the divergence happens *between* them,
// where the chords cut corners — so sample interior points of each raw segment.
let focus: [number, number] = raw[0].coord
let worst = -1
for (let i = 1; i < raw.length; i++) {
  for (const u of [0.3, 0.5, 0.7]) {
    const p: [number, number] = [
      raw[i - 1].coord[0] + (raw[i].coord[0] - raw[i - 1].coord[0]) * u,
      raw[i - 1].coord[1] + (raw[i].coord[1] - raw[i - 1].coord[1]) * u,
    ]
    let best = Infinity
    for (const v of coords) best = Math.min(best, distKm(p, v))
    if (best > worst) {
      worst = best
      focus = p
    }
  }
}
console.log(`max raw↔road divergence: ${Math.round(worst * 1000)}m`)

// --- 5. Emit ---------------------------------------------------------------------
const r1 = (x: number) => Math.round(x * 10) / 10
const durationSec = times[times.length - 1]
const out = `// AUTO-GENERATED by scripts/generate-gps.ts — do not edit by hand.
// Simulates a camasys-style GPS breadcrumb trail (sparse fixes, consumer jitter) on the
// TR-2411 route, then snaps it to the road network with OSRM /match (router.project-osrm.org).
import type { TripData } from "./trips"

export const GPS_TRIP_ID = "TR-2415"

export type Breadcrumb = { coord: [number, number]; t: number }

/** What camasys draws today: the raw fixes, straight lines in between. */
export const breadcrumbs: Breadcrumb[] = ${JSON.stringify(raw.map(({ coord, t }) => ({ coord, t })))}

/** The same drive after map matching — a seamless, road-following route. */
export const gpsTrip: TripData & { confidence: number } = {
  id: GPS_TRIP_ID,
  name: "City handover — raw GPS",
  plate: "BA 525 MK",
  model: "Škoda Fabia",
  startedLabel: "28 Sep · 13:26",
  distanceKm: ${r1(totalKm)}, // same roads as TR-2411 (validated vertex-for-vertex) — chord-sums of the coarser matched polyline would undercount
  durationSec: ${Math.round(durationSec)},
  avgSpeed: ${r1(totalKm / (durationSec / 3600))},
  maxSpeed: ${Math.max(...speeds)},
  confidence: ${Math.round(confidence * 100) / 100},
  coords: ${JSON.stringify(coords)},
  times: ${JSON.stringify(times)},
  speeds: ${JSON.stringify(speeds)},
}

/** Where the raw zigzag diverges most from the road — the demo zooms in here. */
export const matchFocus: [number, number] = ${JSON.stringify(focus)}
`

writeFileSync(join(root, "src", "data", "gps.ts"), out)
console.log(`gps.ts: ${raw.length} breadcrumbs, ${coords.length} matched vertices, ${mTotal.toFixed(1)}km`)
